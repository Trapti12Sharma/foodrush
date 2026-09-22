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

module.exports = { createCouponValidator, updateCouponValidator };
