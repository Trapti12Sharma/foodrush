const mongoose = require('mongoose');
const { DELIVERY_SETTLEMENT_STATUS } = require('../utils/constants');

// Groups one rider's unpaid DeliveryEarning rows for a period into a single
// internal payout record. This is a FOUNDATION only — marking a settlement PAID
// records that an admin has confirmed payment happened by some other means
// (bank transfer, cash, a manual UPI payment); it never itself moves money and
// never talks to Razorpay Payouts, a bank API, or any other real payout
// provider. See deliverySettlement.service.js and DEPLOYMENT.md.
//
// Earnings reference THIS document (DeliveryEarning.settlement), not the other
// way around — no redundant id array to keep in sync, consistent with how the
// rest of this codebase links records (e.g. Order.latestPayment, never an
// array of orders on Payment).
const deliverySettlementSchema = new mongoose.Schema(
  {
    deliveryPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryPartner',
      required: true,
      index: true,
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    deliveryCount: { type: Number, required: true, min: 0 },
    grossAmount: { type: Number, required: true, min: 0 },
    deductions: { type: Number, default: 0, min: 0 },
    netAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    status: {
      type: String,
      enum: Object.values(DELIVERY_SETTLEMENT_STATUS),
      default: DELIVERY_SETTLEMENT_STATUS.PENDING,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    approvedAt: { type: Date, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    // Admin-entered only — e.g. a bank transaction id or UTR the admin typed in
    // after paying the rider by some external means. NEVER a value confirmed by
    // a real payout gateway (none is integrated in this milestone) — the
    // distinction between "we recorded this as paid" and "a bank actually
    // confirmed a transfer" must stay visible to whoever reads this field.
    payoutReference: { type: String, default: null },
    paidAt: { type: Date, default: null },
    paidBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    failedAt: { type: Date, default: null },
    failureReason: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, default: null },
  },
  { timestamps: true }
);

// The real "two admins can't generate the same settlement twice" guard is
// deliverySettlement.service.js atomically claiming each earning first (see
// generate()) — this index is defense in depth, not the primary mechanism,
// since two settlements for the same rider/period with different exact
// earning sets are conceivable (e.g. a late-arriving earning). It does still
// catch the literal double-click / retried-request case.
deliverySettlementSchema.index({ deliveryPartner: 1, periodStart: 1, periodEnd: 1, status: 1 });

module.exports = mongoose.model('DeliverySettlement', deliverySettlementSchema);
