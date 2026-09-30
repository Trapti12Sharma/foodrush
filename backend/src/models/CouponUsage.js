const mongoose = require('mongoose');

// One row per (coupon, order) redemption — how a coupon's perUserLimit is enforced
// (Coupon.usedCount alone only tracks the GLOBAL count, not per customer). Kept even
// after the fact as a redemption history, not just a live counter.
const couponUsageSchema = new mongoose.Schema(
  {
    coupon: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Coupon',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      unique: true, // one usage row per order — never double-counted if an order write is retried
    },
    discountAmount: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true }
);

couponUsageSchema.index({ coupon: 1, user: 1 });
// M16 — coupon analytics filters redemptions by date range, then groups by coupon.
couponUsageSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CouponUsage', couponUsageSchema);
