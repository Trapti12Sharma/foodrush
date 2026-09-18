const express = require('express');
const { body } = require('express-validator');
const couponController = require('../controllers/coupon.controller');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.post(
  '/validate',
  authenticateUser,
  [body('code').trim().notEmpty().withMessage('Coupon code is required'), body('subtotal').isFloat({ min: 0 })],
  validate,
  couponController.validateCoupon
);

// Full coupon CRUD (create/list/deactivate) is an admin capability — Phase 11.

module.exports = router;
