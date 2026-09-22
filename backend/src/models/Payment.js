const mongoose = require('mongoose');
const { PAYMENT_ATTEMPT_STATUS } = require('../utils/constants');

// One row per ONLINE payment ATTEMPT on an order — not per order. An order can have
// several (the first attempt fails or is abandoned, the customer retries), which is
// exactly why this is its own collection rather than a couple of fields on Order:
// Order.paymentStatus/transactionId always mirror the latest attempt for anything
// that only needs "is this order paid", while the full attempt history stays here
// for support and reconciliation.
const paymentSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    provider: {
      type: String,
      enum: ['razorpay'],
      default: 'razorpay',
    },
    razorpayOrderId: {
      type: String,
      required: true,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: 'INR',
    },
    status: {
      type: String,
      enum: Object.values(PAYMENT_ATTEMPT_STATUS),
      default: PAYMENT_ATTEMPT_STATUS.CREATED,
    },
    failureReason: {
      type: String,
      default: null,
    },
    // How this attempt was confirmed — helps distinguish "customer's browser called
    // verify-payment" from "we only found out via the webhook" during support/audit.
    confirmedVia: {
      type: String,
      enum: ['verify_endpoint', 'webhook', null],
      default: null,
    },
  },
  { timestamps: true }
);

paymentSchema.index({ order: 1, createdAt: -1 });

module.exports = mongoose.model('Payment', paymentSchema);
