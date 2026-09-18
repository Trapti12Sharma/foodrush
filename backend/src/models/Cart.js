const mongoose = require('mongoose');

const cartAddonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const cartItemSchema = new mongoose.Schema(
  {
    food: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodItem',
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    // Snapshot price at the moment the item was added — shown for a responsive UI only.
    // The cart/order service always re-fetches the live FoodItem price before charging;
    // this field is never trusted as the source of truth (see cart.service.js, Phase 6).
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    addons: {
      type: [cartAddonSchema],
      default: [],
    },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    // Locks the cart to a single restaurant — a food-delivery cart cannot mix
    // items from two restaurants in one order (section 7). Cleared when the cart
    // is emptied so a new restaurant can be selected next.
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      default: null,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
    subtotal: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    discount: { type: Number, default: 0, min: 0 },
    total: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Cart', cartSchema);
