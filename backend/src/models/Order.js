const mongoose = require('mongoose');
const { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS } = require('../utils/constants');

const orderAddonSchema = new mongoose.Schema(
  { name: String, price: Number },
  { _id: false }
);

// Order items are a frozen snapshot (name/price copied at purchase time), not a live
// reference — so a later menu price change or item deletion never rewrites history.
const orderItemSchema = new mongoose.Schema(
  {
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'FoodItem', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    addons: { type: [orderAddonSchema], default: [] },
    variantName: { type: String, default: null },
    note: { type: String, default: '' },
  },
  { _id: false }
);

// Delivery address is copied, not referenced, for the same reason — editing/deleting
// the saved Address later must not alter a placed order's delivery details.
const deliveryAddressSchema = new mongoose.Schema(
  {
    label: String,
    name: String,
    phone: String,
    addressLine: { type: String, required: true },
    addressLine2: String,
    landmark: String,
    city: { type: String, required: true },
    state: String,
    pincode: { type: String, required: true },
    latitude: Number,
    longitude: Number,
  },
  { _id: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: { type: String, enum: Object.values(ORDER_STATUS), required: true },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    // Short, human-readable id (FR00000001...) — see utils/orderNumber.js. Kept
    // separate from _id so support conversations and receipts have something a
    // customer can actually read out. `required` only binds new saves going
    // forward — pre-existing production orders predate this field entirely, so
    // the index MUST be sparse: a plain unique index treats a missing field as
    // null and would refuse to let more than one such legacy order exist,
    // breaking index creation against real data before migrate-order-statuses.js
    // ever gets a chance to backfill it.
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      sparse: true,
      index: true,
    },
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
    items: {
      type: [orderItemSchema],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'Order must contain at least one item',
      },
    },
    deliveryAddress: {
      type: deliveryAddressSchema,
      required: true,
    },
    // Straight-line km from the restaurant, measured at order time (null when the address
    // had no coordinates). Basis for delivery pricing/earnings in later milestones.
    deliveryDistanceKm: {
      type: Number,
      default: null,
    },
    subtotal: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    tax: { type: Number, required: true, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    coupon: {
      code: String,
      discountAmount: Number,
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PAYMENT_METHODS),
      required: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.PENDING,
    },
    orderStatus: {
      type: String,
      enum: Object.values(ORDER_STATUS),
      default: ORDER_STATUS.PLACED,
      index: true,
    },
    statusHistory: {
      type: [statusHistorySchema],
      default: [],
    },
    // Mirrors the latest ONLINE payment attempt (see models/Payment.js for the full
    // attempt history). Left untouched for COD orders.
    transactionId: {
      type: String,
      default: null,
    },
    razorpayOrderId: {
      type: String,
      default: null,
    },
    latestPayment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      default: null,
    },
    estimatedDeliveryTime: {
      type: Date,
      default: null,
    },
    cancellationReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
