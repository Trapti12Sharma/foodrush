const express = require('express');
const { body } = require('express-validator');
const couponController = require('../controllers/coupon.controller');
const { createCouponValidator, updateCouponValidator } = require('../validators/coupon.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.post(
  '/validate',
  authenticateUser,
  [body('code').trim().notEmpty().withMessage('Coupon code is required'), body('subtotal').isFloat({ min: 0 })],
  validate,
  couponController.validateCoupon
);

router.use(authenticateUser, authorizeRoles(ROLES.ADMIN));

router.post('/', createCouponValidator, validate, couponController.createCoupon);
router.get('/', couponController.listCoupons);
router.patch('/:id', updateCouponValidator, validate, couponController.updateCoupon);

module.exports = router;
