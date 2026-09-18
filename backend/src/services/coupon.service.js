const Coupon = require('../models/Coupon');
const ApiError = require('../utils/ApiError');
const { DISCOUNT_TYPES } = require('../utils/constants');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

// Pure validation + discount calculation, reused by both the standalone
// "validate this code" endpoint and cart.service's apply/recalculate paths.
// Does NOT increment usedCount — that only happens once an order is actually
// placed (Phase 7 order.service.js), so merely checking a code doesn't burn a use.
async function validateCoupon(code, subtotal) {
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

  let discountAmount =
    coupon.discountType === DISCOUNT_TYPES.PERCENTAGE ? (subtotal * coupon.discountValue) / 100 : coupon.discountValue;

  if (coupon.discountType === DISCOUNT_TYPES.PERCENTAGE && coupon.maximumDiscount != null) {
    discountAmount = Math.min(discountAmount, coupon.maximumDiscount);
  }
  // Never discount more than the order itself is worth.
  discountAmount = Math.min(Math.round(discountAmount * 100) / 100, subtotal);

  return { coupon, discountAmount };
}

async function incrementUsage(couponId) {
  await Coupon.findByIdAndUpdate(couponId, { $inc: { usedCount: 1 } });
}

const CREATE_FIELDS = ['description', 'discountType', 'discountValue', 'minimumOrder', 'maximumDiscount', 'expiryDate', 'usageLimit'];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'isActive'];

async function createCoupon(payload) {
  const code = payload.code.trim().toUpperCase();
  const existing = await Coupon.findOne({ code });
  if (existing) throw ApiError.conflict('A coupon with this code already exists');

  const data = {};
  CREATE_FIELDS.forEach((field) => {
    if (payload[field] !== undefined) data[field] = payload[field];
  });
  return Coupon.create({ ...data, code });
}

async function listCoupons(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.search) filter.code = new RegExp(query.search.trim().toUpperCase());
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

  const [items, total] = await Promise.all([
    Coupon.find(filter).sort('-createdAt').skip(skip).limit(limit),
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
  await coupon.save();
  return coupon;
}

module.exports = { validateCoupon, incrementUsage, createCoupon, listCoupons, updateCoupon };
