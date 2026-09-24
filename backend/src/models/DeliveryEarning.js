const mongoose = require('mongoose');
const { DELIVERY_EARNING_STATUS } = require('../utils/constants');

// One row per successfully COMPLETED delivery — created exactly once, from
// deliveryAssignment.service.js#onOrderStatusChanged the instant an assignment
// reaches COMPLETED (whether via the M9 OTP-verify path or the restaurant/
// admin's manual completion fallback — both funnel through that one hook).
//
// Money follows the EXACT convention already used everywhere else in this
// codebase (Order/Payment/Refund): plain Number, rounded to whole paise via
// pricing.service.js's shared round2() at every step — never Decimal128, never
// raw floating-point arithmetic left unrounded. See deliveryEarning.service.js.
const deliveryEarningSchema = new mongoose.Schema(
  {
    deliveryPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryPartner',
      required: true,
      index: true,
    },
    // Unique — the actual, database-enforced "never pay twice for the same
    // delivery" guarantee, on top of onOrderStatusChanged's own atomic
    // ASSIGNED->COMPLETED transition already making this a one-time call in
    // practice. Belt and suspenders, exactly like DeliveryAssignment's own
    // partial unique index on `order`.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    deliveryAssignment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryAssignment',
      required: true,
    },
    // Denormalized purely for display (the rider's earnings list shows "Delivery
    // #FR00000123" without a populate on every row) — never used for any lookup
    // or authorization decision, which always goes through the real refs above.
    orderNumber: {
      type: String,
      required: true,
    },
    baseAmount: { type: Number, required: true, min: 0 },
    // The distance actually used for this calculation, snapshotted at earning
    // time — null when the order had no reliable deliveryDistanceKm, in which
    // case distanceAmount is 0 and this stays null (never a guessed value).
    distanceKm: { type: Number, default: null },
    distanceAmount: { type: Number, required: true, min: 0 },
    // Always 0 in this milestone (no surge/incentive rules exist yet) — the
    // field exists so a future milestone can populate it without a schema
    // change, exactly like DeliveryAssignment.rejectionReason-style forward
    // declarations elsewhere in this codebase.
    incentiveAmount: { type: Number, default: 0, min: 0 },
    // base + distance + incentive, BEFORE the configured floor/ceiling clamp.
    grossAmount: { type: Number, required: true, min: 0 },
    // Always 0 in this milestone — no platform-commission-on-rider-earnings
    // rule exists to justify a nonzero value; reserved for when one does.
    deductions: { type: Number, default: 0, min: 0 },
    // grossAmount - deductions, clamped to the configured min/max — the actual
    // amount this rider is owed for this delivery.
    netAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    // PENDING until the settlement that includes it is actually marked PAID —
    // see deliverySettlement.service.js#markPaid, the only place this flips.
    status: {
      type: String,
      enum: Object.values(DELIVERY_EARNING_STATUS),
      default: DELIVERY_EARNING_STATUS.PENDING,
      index: true,
    },
    // Set once a settlement claims this earning (generation), cleared again if
    // that settlement is CANCELLED before being paid — freeing this earning up
    // for a future settlement run.
    settlement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliverySettlement',
      default: null,
      index: true,
    },
    settledAt: {
      type: Date,
      default: null,
    },
    // When the delivery was actually completed (DeliveryAssignment.completedAt)
    // — the basis for settlement-period filtering, not createdAt.
    earnedAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

deliveryEarningSchema.index({ deliveryPartner: 1, status: 1, earnedAt: 1 });

module.exports = mongoose.model('DeliveryEarning', deliveryEarningSchema);
