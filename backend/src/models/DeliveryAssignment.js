const mongoose = require('mongoose');
const { DELIVERY_ASSIGNMENT_STATUS, ACTIVE_ASSIGNMENT_STATUSES } = require('../utils/constants');

// One row per rider an order was offered to — an order can accumulate several of
// these over its dispatch lifetime (rejections, expiries), forming a full history.
// At most one row per order may ever be "active" (OFFERED/ACCEPTED/ASSIGNED) at a
// time: enforced by the partial unique index below at the DATABASE level, not just
// in application code, so two concurrent dispatch attempts for the same order can
// never both succeed.
const deliveryAssignmentSchema = new mongoose.Schema(
  {
    // Not `index: true` here — the partial unique index and the {order, createdAt}
    // index below already cover every query this field needs.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
    },
    deliveryPartner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DeliveryPartner',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(DELIVERY_ASSIGNMENT_STATUS),
      default: DELIVERY_ASSIGNMENT_STATUS.OFFERED,
      index: true,
    },
    offeredAt: {
      type: Date,
      default: Date.now,
    },
    // Deadline to respond. Expiry is determined lazily from this timestamp
    // wherever it matters (accept/create queries) — never a background timer,
    // since Render can restart/sleep a running process at any time.
    expiresAt: {
      type: Date,
      required: true,
    },
    // Set the moment the rider responds, whichever way — a quick "how long did
    // they take to answer" signal independent of accept/reject.
    respondedAt: {
      type: Date,
      default: null,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    // Set only once the order-claim step also succeeds (see
    // deliveryAssignment.service.js) — kept distinct from acceptedAt because that
    // second step is a separate atomic operation that can, rarely, lose a race.
    assignedAt: {
      type: Date,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    // Straight-line km from the restaurant to the rider at the moment this offer
    // was created — a snapshot for display/history, not a live tracking value.
    distanceKmAtOffer: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

deliveryAssignmentSchema.index(
  { order: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ACTIVE_ASSIGNMENT_STATUSES } } }
);
deliveryAssignmentSchema.index({ order: 1, createdAt: -1 });
deliveryAssignmentSchema.index({ deliveryPartner: 1, status: 1 });

module.exports = mongoose.model('DeliveryAssignment', deliveryAssignmentSchema);
