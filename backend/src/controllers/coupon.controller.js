const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const couponService = require('../services/coupon.service');

// Standalone check — doesn't touch the cart, just answers "is this code valid
// for this subtotal, and what would it save". Cart.service.applyCoupon (see
// /api/cart/coupon) is what actually attaches it to a cart.
const validateCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  const { coupon, discountAmount } = await couponService.validateCoupon(code, Number(subtotal) || 0);
  res.json(
    new ApiResponse(200, 'Coupon is valid', {
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discountAmount,
    })
  );
});

module.exports = { validateCoupon };
