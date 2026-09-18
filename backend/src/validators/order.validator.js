const { body } = require('express-validator');
const { PAYMENT_METHODS, ORDER_STATUS } = require('../utils/constants');

const createOrderValidator = [
  body('addressId').isMongoId().withMessage('A valid address id is required'),
  body('paymentMethod').isIn(Object.values(PAYMENT_METHODS)).withMessage('Invalid payment method'),
];

const updateStatusValidator = [
  body('status').isIn(Object.values(ORDER_STATUS)).withMessage('Invalid order status'),
];

const cancelOrderValidator = [body('reason').optional({ checkFalsy: true }).trim().isString()];

const verifyPaymentValidator = [
  body('razorpayOrderId').trim().notEmpty().withMessage('razorpayOrderId is required'),
  body('razorpayPaymentId').trim().notEmpty().withMessage('razorpayPaymentId is required'),
  body('signature').trim().notEmpty().withMessage('signature is required'),
];

module.exports = { createOrderValidator, updateStatusValidator, cancelOrderValidator, verifyPaymentValidator };
