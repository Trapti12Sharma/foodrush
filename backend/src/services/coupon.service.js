const Coupon = require('../models/Coupon');
const CouponUsage = require('../models/CouponUsage');
const ApiError = require('../utils/ApiError');
const { DISCOUNT_TYPES } = require('../utils/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

// Pure validation + discount calculation, reused by the standalone "validate this
// code" endpoint and cart.service's apply/recalculate paths. Does NOT increment
// usedCount or write a CouponUsage row — that only happens once an order is
// actually placed (redeemCoupon, called from order.service.js), so merely checking
// a code doesn't burn a use.
//
// `context.restaurantId`/`context.city` scope-check a restaurant- or city-limited
// coupon; `context.userId` enforces perUserLimit via CouponUsage. The per-user check
// is a plain read (see redeemCoupon below for why the GLOBAL limit is atomic but
// this one isn't) — the honest trade-off is documented there.
async function validateCoupon(code, subtotal, context = {}) {
  if (!code) throw ApiError.badRequest('Coupon code is required');

  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
  if (!coupon || !coupon.isActive) throw ApiError.badRequest('Invalid coupon code');
  if (coupon.expiryDate < new Date()) throw ApiError.badRequest('This coupon has expired');
  if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
    throw ApiError.badRequest('This coupon has reached its usage limit');
  }
  if (subtotal < coupon.minimumOrder) {
    throw ApiError.badRequest(`This coupon requires a minimum order of ₹${coupon.minimumOrder}`);
  }
  if (coupon.restaurant && String(coupon.restaurant) !== String(context.restaurantId)) {
    throw ApiError.badRequest('This coupon is not valid for this restaurant');
  }
  if (!coupon.restaurant && coupon.city && coupon.city.toLowerCase() !== String(context.city || '').toLowerCase()) {
    throw ApiError.badRequest(`This coupon is only valid in ${coupon.city}`);
  }
  if (coupon.perUserLimit != null && context.userId) {
    const usedByThisUser = await CouponUsage.countDocuments({ coupon: coupon._id, user: context.userId });
    if (usedByThisUser >= coupon.perUserLimit) {
      throw ApiError.badRequest('You have already used this coupon the maximum number of times');
    }
  }

  let discountAmount =
    coupon.discountType === DISCOUNT_TYPES.PERCENTAGE ? (subtotal * coupon.discountValue) / 100 : coupon.discountValue;

  if (coupon.discountType === DISCOUNT_TYPES.PERCENTAGE && coupon.maximumDiscount != null) {
    discountAmount = Math.min(discountAmount, coupon.maximumDiscount);
  }
  // Never discount more than the order itself is worth.
  discountAmount = Math.min(Math.round(discountAmount * 100) / 100, subtotal);

  return { coupon, discountAmount };
}

// Atomically claims one use of a coupon against the GLOBAL usageLimit. The check and
// the increment happen in a single database operation, so two simultaneous
// checkouts can never both take the last remaining use.
//
// The PER-USER limit is not made atomic the same way: doing so for an arbitrary N
// would need its own atomic per-(coupon,user) counter, and a customer racing
// themselves to reuse a promo a few milliseconds apart is a fraud/reconciliation
// concern, not a money-safety one the way over-selling the global cap is — an
// honest, deliberately scoped trade-off rather than an oversight.
async function redeemCoupon(couponId) {
  return Coupon.findOneAndUpdate(
    {
      _id: couponId,
      isActive: true,
      expiryDate: { $gt: new Date() },
      $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
    },
    { $inc: { usedCount: 1 } },
    { new: true }
  );
}

// Hands a redeemed use back — called when the order it was claimed for failed to
// be created, so a failed checkout doesn't burn a customer's coupon.
async function releaseCoupon(couponId) {
  await Coupon.updateOne({ _id: couponId, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
}

// Records that `user` redeemed `coupon` on `order` — the per-user history
// validateCoupon's perUserLimit check reads. Called once an order has actually been
// created (never before), so there is nothing to roll back if this itself fails;
// a failure here is logged and swallowed rather than failing the order, the same
// "a side effect must not break the primary action" rule used elsewhere (e.g. image
// cleanup, audit logging).
async function recordUsage({ couponId, userId, orderId, discountAmount }) {
  try {
    await CouponUsage.create({ coupon: couponId, user: userId, order: orderId, discountAmount });
  } catch (err) {
    console.error(`Failed to record coupon usage for order ${orderId}:`, err.message);
  }
}

const CREATE_FIELDS = [
  'description', 'discountType', 'discountValue', 'minimumOrder', 'maximumDiscount', 'expiryDate', 'usageLimit',
  'perUserLimit', 'restaurant', 'city', 'fundedBy',
];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'isActive'];

function normalizeScope(data) {
  // A coupon scoped to one restaurant already implies a city — never both at once.
  if (data.restaurant) data.city = null;
  return data;
}

async function createCoupon(payload) {
  const code = payload.code.trim().toUpperCase();
  const existing = await Coupon.findOne({ code });
  if (existing) throw ApiError.conflict('A coupon with this code already exists');

  const data = {};
  CREATE_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) data[field] = payload[field];
  });
  return Coupon.create({ ...normalizeScope(data), code });
}

async function listCoupons(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.search) filter.code = new RegExp(query.search.trim().toUpperCase());
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.restaurant) filter.restaurant = query.restaurant;

  const [items, total] = await Promise.all([
    Coupon.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('restaurant', 'name'),
    Coupon.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function updateCoupon(id, payload) {
  const coupon = await Coupon.findById(id);
  if (!coupon) throw ApiError.notFound('Coupon not found');

  UPDATE_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) coupon[field] = payload[field];
  });
  normalizeScope(coupon);
  await coupon.save();
  return coupon;
}

module.exports = { validateCoupon, redeemCoupon, releaseCoupon, recordUsage, createCoupon, listCoupons, updateCoupon };
