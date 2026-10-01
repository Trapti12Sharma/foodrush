const { body } = require('express-validator');
const { DISCOUNT_TYPES, COUPON_FUNDED_BY } = require('../utils/constants');

const scopeRules = [
  body('perUserLimit').optional({ nullable: true }).isInt({ min: 1 }),
  body('restaurant').optional({ nullable: true }).isMongoId().withMessage('Invalid restaurant id'),
  body('city').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('fundedBy').optional().isIn(Object.values(COUPON_FUNDED_BY)).withMessage('Invalid fundedBy value'),
];

const createCouponValidator = [
  body('code').trim().notEmpty().withMessage('Coupon code is required'),
  body('description').optional({ checkFalsy: true }).trim(),
  body('discountType').isIn(Object.values(DISCOUNT_TYPES)).withMessage('Invalid discount type'),
  body('discountValue').isFloat({ min: 0 }).withMessage('Discount value must be a positive number'),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('maximumDiscount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('expiryDate').isISO8601().withMessage('A valid expiry date is required'),
  body('usageLimit').optional({ nullable: true }).isInt({ min: 1 }),
  ...scopeRules,
];

const updateCouponValidator = [
  body('description').optional({ checkFalsy: true }).trim(),
  body('discountType').optional().isIn(Object.values(DISCOUNT_TYPES)),
  body('discountValue').optional().isFloat({ min: 0 }),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('maximumDiscount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('expiryDate').optional().isISO8601(),
  body('usageLimit').optional({ nullable: true }).isInt({ min: 1 }),
  body('isActive').optional().isBoolean(),
  ...scopeRules,
];

// Owner-facing equivalents of the two above, for a restaurant managing its own
// coupons via /restaurants/:id/coupons. Deliberately omit `...scopeRules`
// entirely: `restaurant`/`city`/`fundedBy` are never read from the request body
// on that path (coupon.service.js#createForRestaurant/updateForRestaurant
// force them server-side), so there is nothing to validate on fields that
// would be ignored anyway — and no rule here could create the false impression
// that submitting them has any effect.
const createOwnCouponValidator = [
  body('code').trim().notEmpty().withMessage('Coupon code is required'),
  body('description').optional({ checkFalsy: true }).trim(),
  body('discountType').isIn(Object.values(DISCOUNT_TYPES)).withMessage('Invalid discount type'),
  body('discountValue').isFloat({ min: 0 }).withMessage('Discount value must be a positive number'),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('maximumDiscount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('expiryDate').isISO8601().withMessage('A valid expiry date is required').bail().custom((value) => new Date(value) > new Date()).withMessage('Expiry date must be in the future'),
  body('usageLimit').optional({ nullable: true }).isInt({ min: 1 }),
  body('perUserLimit').optional({ nullable: true }).isInt({ min: 1 }),
];

const updateOwnCouponValidator = [
  body('description').optional({ checkFalsy: true }).trim(),
  body('discountType').optional().isIn(Object.values(DISCOUNT_TYPES)),
  body('discountValue').optional().isFloat({ min: 0 }),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('maximumDiscount').optional({ nullable: true }).isFloat({ min: 0 }),
  body('expiryDate').optional().isISO8601().bail().custom((value) => new Date(value) > new Date()).withMessage('Expiry date must be in the future'),
  body('usageLimit').optional({ nullable: true }).isInt({ min: 1 }),
  body('perUserLimit').optional({ nullable: true }).isInt({ min: 1 }),
  body('isActive').optional().isBoolean(),
];

module.exports = { createCouponValidator, updateCouponValidator, createOwnCouponValidator, updateOwnCouponValidator };
