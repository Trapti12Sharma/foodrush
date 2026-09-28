const mongoose = require('mongoose');
const { REVIEW_MODERATION_STATUS } = require('../utils/constants');

const reviewSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    // One review per order, enforced by the unique index below — also proves the
    // reviewer actually ordered from this restaurant (section 13).
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      default: '',
    },
    images: {
      type: [String],
      default: [],
    },

    // M15 — Review Moderation & Trust System. Kept separate from the customer's
    // review content above (see constants.js for the status graph) — a customer
    // never sees moderatedBy/reportCount, only their own moderationStatus/
    // moderationReason (review.service.js's public serializer strips the rest).
    moderationStatus: {
      type: String,
      enum: Object.values(REVIEW_MODERATION_STATUS),
      default: REVIEW_MODERATION_STATUS.PENDING,
      index: true,
    },
    moderationReason: { type: String, default: null },
    moderatedAt: { type: Date, default: null },
    moderatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    // Denormalized from ReviewReport (Model) so admin listing/filtering never
    // needs a join just to sort "most-reported first" or show a count badge.
    // Kept in sync with an atomic $inc alongside each new ReviewReport (see
    // review.service.js#createReport) — never read-modify-write, so concurrent
    // reports can't lose an increment.
    reportCount: { type: Number, default: 0, min: 0 },
    reportedAt: { type: Date, default: null }, // most recent report, if any
  },
  { timestamps: true }
);

// restaurant/order/user already have single-field indexes via `index: true`
// above; these are the additional compound ones the admin queue and public
// listing actually filter/sort by (see review.service.js).
reviewSchema.index({ restaurant: 1, moderationStatus: 1 });
reviewSchema.index({ moderationStatus: 1, createdAt: -1 });
reviewSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Review', reviewSchema);
