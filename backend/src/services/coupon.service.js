const Coupon = require('../models/Coupon');
const CouponUsage = require('../models/CouponUsage');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { DISCOUNT_TYPES, COUPON_FUNDED_BY } = require('../utils/constants');
const { PERMISSIONS } = require('../utils/permissions');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');
const { assertOwnerOrAdmin } = require('../utils/ownership');

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
  // M18 — escaped, like every other search in this codebase. Unescaped, a staff
  // member searching for something like "(a+)+$" would hand the regex engine a
  // catastrophically backtracking pattern, and because Node is single-threaded
  // that is not a slow query, it is the whole API hanging. Coupon codes are
  // alphanumeric, so no legitimate search ever needs a metacharacter to keep its
  // special meaning. Still unanchored, so this remains a substring match.
  if (query.search) filter.code = new RegExp(escapeRegex(query.search.trim().toUpperCase()));
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

// --- Restaurant-owner-scoped coupon management ---
//
// A restaurant owner may create and manage coupons, but ONLY for their own
// restaurant — never platform-wide or city-wide ones (those remain exclusively
// an admin/COUPONS_MANAGE action via createCoupon/listCoupons/updateCoupon
// above). The three functions below are the owner-facing counterparts: each
// takes the restaurant id from the URL, not from the request body, and FORCES
// `restaurant`/`city`/`fundedBy` server-side rather than trusting the payload —
// so even a client that sends `{ restaurant: '<someone else's restaurant>' }`
// or `{ city: 'Mumbai' }` cannot escape its own restaurant's scope. This is the
// same "ignore what a client claims, derive it server-side" rule the Cloudinary
// publicId and KYC review fields already follow elsewhere in this codebase.
const OWNER_EDITABLE_FIELDS = [
  'description', 'discountType', 'discountValue', 'minimumOrder', 'maximumDiscount', 'expiryDate', 'usageLimit', 'perUserLimit',
];

async function assertRestaurantAccess(restaurantId, user) {
  const restaurant = await Restaurant.findById(restaurantId).select('owner');
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, user, 'Only this restaurant\'s owner or an admin can manage its coupons', PERMISSIONS.COUPONS_MANAGE);
  return restaurant;
}

async function listForRestaurant(restaurantId, user, query) {
  await assertRestaurantAccess(restaurantId, user);
  const { page, limit, skip } = parsePagination(query);
  const filter = { restaurant: restaurantId };
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

  const [items, total] = await Promise.all([
    Coupon.find(filter).sort('-createdAt').skip(skip).limit(limit),
    Coupon.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function createForRestaurant(restaurantId, user, payload) {
  await assertRestaurantAccess(restaurantId, user);
  const code = (payload.code || '').trim().toUpperCase();
  if (!code) throw ApiError.badRequest('Coupon code is required');
  const existing = await Coupon.findOne({ code });
  if (existing) throw ApiError.conflict('A coupon with this code already exists');

  const data = {};
  OWNER_EDITABLE_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) data[field] = payload[field];
  });
  // The owner is the one giving up margin on their own promotion — never
  // PLATFORM (that would mean the platform absorbs a discount it never agreed
  // to fund) and never client-settable.
  return Coupon.create({ ...data, code, restaurant: restaurantId, city: null, fundedBy: COUPON_FUNDED_BY.RESTAURANT });
}

async function updateForRestaurant(restaurantId, couponId, user, payload) {
  await assertRestaurantAccess(restaurantId, user);
  const coupon = await Coupon.findOne({ _id: couponId, restaurant: restaurantId });
  if (!coupon) throw ApiError.notFound('Coupon not found for this restaurant');

  OWNER_EDITABLE_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) coupon[field] = payload[field];
  });
  if (payload.isActive !== undefined) coupon.isActive = payload.isActive;
  // restaurant/city/fundedBy are deliberately never read from payload here —
  // there is no code path by which an owner's coupon can be re-scoped.
  await coupon.save();
  return coupon;
}

// --- Customer-facing discovery ---
//
// "What offers can I use here?" for a restaurant's page/checkout — the
// counterpart to validateCoupon's "is THIS specific code valid" check. Applies
// the identical scope rule (own restaurant, OR city-wide with no restaurant, OR
// fully platform-wide) and the identical isActive/expiry/global-usage-limit
// checks, so nothing shown here can fail those checks when actually applied.
//
// What it deliberately does NOT guarantee: minimumOrder (the cart's subtotal
// isn't known yet) and perUserLimit are still re-checked for real at apply time
// (POST /cart/coupon) — but perUserLimit IS filtered out here too, so a coupon a
// customer has already exhausted their personal uses of is not dangled in front
// of them as if it were still available.
async function listAvailableForCustomer({ restaurantId, userId }) {
  if (!restaurantId) return [];
  const restaurant = await Restaurant.findById(restaurantId).select('city');
  if (!restaurant) return [];

  const now = new Date();
  const candidates = await Coupon.find({
    isActive: true,
    expiryDate: { $gt: now },
    $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
    $and: [
      {
        $or: [
          { restaurant: restaurantId },
          { restaurant: null, city: restaurant.city },
          { restaurant: null, city: null },
        ],
      },
    ],
  })
    .select('code description discountType discountValue minimumOrder maximumDiscount expiryDate perUserLimit')
    .sort('-discountValue')
    .lean();

  if (candidates.length === 0) return candidates;

  // One query for every candidate's per-user usage count, rather than one query
  // per coupon — a restaurant page with a handful of active offers should not
  // cost a handful of round trips.
  const usageCounts = userId
    ? await CouponUsage.aggregate([
        { $match: { user: userId, coupon: { $in: candidates.map((c) => c._id) } } },
        { $group: { _id: '$coupon', count: { $sum: 1 } } },
      ])
    : [];
  const usedById = new Map(usageCounts.map((row) => [String(row._id), row.count]));

  return candidates
    .filter((c) => c.perUserLimit == null || (usedById.get(String(c._id)) || 0) < c.perUserLimit)
    .map(({ perUserLimit, ...rest }) => rest); // internal to the filter above, not customer-facing
}

module.exports = {
  validateCoupon,
  redeemCoupon,
  releaseCoupon,
  recordUsage,
  createCoupon,
  listCoupons,
  updateCoupon,
  listForRestaurant,
  createForRestaurant,
  updateForRestaurant,
  listAvailableForCustomer,
};
