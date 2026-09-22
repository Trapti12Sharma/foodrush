const mongoose = require('mongoose');
const { DISCOUNT_TYPES, COUPON_FUNDED_BY } = require('../utils/constants');

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Coupon code is required'],
      unique: true,
      uppercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    discountType: {
      type: String,
      enum: Object.values(DISCOUNT_TYPES),
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 0,
    },
    minimumOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Only meaningful for PERCENTAGE coupons — caps the rupee discount so e.g.
    // "20% off" can't blow out on a huge order.
    maximumDiscount: {
      type: Number,
      default: null,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    usageLimit: {
      type: Number,
      default: null, // null = unlimited, across ALL customers
    },
    // How many times ONE customer may use this coupon; null = unlimited per customer
    // (still subject to usageLimit above). Enforced via the CouponUsage collection,
    // since Coupon itself only tracks a single global counter.
    perUserLimit: {
      type: Number,
      default: null,
      min: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
    },
    // Scope: null/absent = platform-wide. Set ONE of these to narrow a coupon to a
    // single restaurant, or to every restaurant in a city — never both at once
    // (enforced in coupon.service.js), since a restaurant already implies a city.
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null,
    },
    city: {
      type: String,
      trim: true,
      default: null,
    },
    // Who bears the discount — recorded for settlement reporting; does not itself
    // change how the discount is calculated.
    fundedBy: {
      type: String,
      enum: Object.values(COUPON_FUNDED_BY),
      default: COUPON_FUNDED_BY.PLATFORM,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Coupon', couponSchema);
