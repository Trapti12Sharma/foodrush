const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const couponService = require('../services/coupon.service');
const auditService = require('../services/audit.service');

// Standalone check — doesn't touch the cart, just answers "is this code valid
// for this subtotal, and what would it save". Cart.service.applyCoupon (see
// /api/cart/coupon) is what actually attaches it to a cart.
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal, restaurantId, city } = req.body;
  const context = { restaurantId, city, userId: req.user._id };
  const { coupon, discountAmount } = await couponService.validateCoupon(code, Number(subtotal) || 0, context);
  res.json(
    new ApiResponse(200, 'Coupon is valid', {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
    })
  );
});

const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.createCoupon(req.body);
  await auditService.record({
    req,
    action: 'coupon.create',
    entityType: 'Coupon',
    entityId: coupon._id,
    metadata: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue },
  });
  res.status(201).json(new ApiResponse(201, 'Coupon created', { coupon }));
});

const listCoupons = asyncHandler(async (req, res) => {
  const { items, pagination } = await couponService.listCoupons(req.query);
  res.json(new ApiResponse(200, 'Coupons fetched', { coupons: items, pagination }));
});

const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await couponService.updateCoupon(req.params.id, req.body);
  await auditService.record({
    req,
    action: 'coupon.update',
    entityType: 'Coupon',
    entityId: coupon._id,
    metadata: { code: coupon.code, changes: req.body },
  });
  res.json(new ApiResponse(200, 'Coupon updated', { coupon }));
});

module.exports = { validateCoupon, createCoupon, listCoupons, updateCoupon };
