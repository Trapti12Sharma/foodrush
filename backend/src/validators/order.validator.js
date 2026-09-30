const { body } = require('express-validator');
const { PAYMENT_METHODS, ORDER_STATUS } = require('../utils/constants');

const createOrderValidator = [
  body('addressId').isMongoId().withMessage('A valid address id is required'),
  body('paymentMethod').isIn(Object.values(PAYMENT_METHODS)).withMessage('Invalid payment method'),
];

const updateStatusValidator = [
  body('status').isIn(Object.values(ORDER_STATUS)).withMessage('Invalid order status'),
  // Only meaningful when accepting an order (-> CONFIRMED): how long the kitchen
  // says it needs. Ignored for every other transition.
  body('prepMinutes')
    .optional()
    .isInt({ min: 5, max: 180 })
    .withMessage('Preparation time must be between 5 and 180 minutes')
    .toInt(),
];

const cancelOrderValidator = [body('reason').optional({ checkFalsy: true }).trim().isString()];

const verifyPaymentValidator = [
  body('razorpayOrderId').trim().notEmpty().withMessage('razorpayOrderId is required'),
  body('razorpayPaymentId').trim().notEmpty().withMessage('razorpayPaymentId is required'),
  body('signature').trim().notEmpty().withMessage('signature is required'),
];

module.exports = { createOrderValidator, updateStatusValidator, cancelOrderValidator, verifyPaymentValidator };
