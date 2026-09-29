const mongoose = require('mongoose');
const { REFUND_STATUS } = require('../utils/constants');

// The ledger of refund attempts — kept separate from Order so an order that needed
// two refund attempts (e.g. the first Razorpay call failed) has a full, honest trail
// rather than a single field being overwritten.
const refundSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      enum: ['customer_cancellation', 'restaurant_rejection', 'restaurant_unavailable', 'operational_issue', 'admin_initiated'],
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.PENDING,
    },
    razorpayRefundId: {
      type: String,
      default: null,
    },
    // null = triggered automatically by the system (e.g. an auto-refund on cancellation).
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    failureReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

refundSchema.index({ order: 1, createdAt: -1 });
// M16 — analytics reads refunds by status within a date range (only COMPLETED
// refunds count as money returned), which this serves directly.
refundSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Refund', refundSchema);
