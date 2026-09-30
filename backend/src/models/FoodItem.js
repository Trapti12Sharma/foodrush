const mongoose = require('mongoose');

const addonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    isAvailable: { type: Boolean, default: true },
  },
  { _id: true }
);

// e.g. Small/Medium/Large, or Half/Full. When a food has any variants, ordering it
// requires picking one (see cart.service.js) — its own `price`/`discountPrice` then serve
// only as the "from ₹x" figure shown before a variant is chosen (see foodItem.service.js).
const variantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    price: { type: Number, required: true, min: 0 },
    discountPrice: {
      type: Number,
      min: 0,
      validate: { validator: function validateVariantDiscount(value) { return value == null || value <= this.price; }, message: 'A variant discount price cannot exceed its own price' },
    },
    isAvailable: { type: Boolean, default: true },
  },
  { _id: true }
);

const foodItemSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
      index: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodCategory',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Food name is required'],
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    image: {
      type: String,
      default: '',
    },
    // M13 — see Restaurant.js's identical field for why this exists and how it's set.
    imagePublicId: { type: String, default: null },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: 0,
    },
    discountPrice: {
      type: Number,
      min: 0,
      validate: {
        validator: function validateDiscount(value) {
          return value == null || value <= this.price;
        },
        message: 'Discount price cannot exceed the base price',
      },
    },
    isVeg: {
      type: Boolean,
      required: true,
      default: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    preparationTime: {
      type: Number, // minutes
      default: 15,
      min: 0,
    },
    addons: {
      type: [addonSchema],
      default: [],
    },
    variants: {
      type: [variantSchema],
      default: [],
    },
    // Owner-curated, shown in the "Recommended" section of the menu page.
    isRecommended: {
      type: Boolean,
      default: false,
    },
    // Owner-set for now — an automatic version (from real order counts) belongs to analytics.
    isBestseller: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

foodItemSchema.index({ name: 'text', description: 'text' });
foodItemSchema.index({ restaurant: 1, category: 1 });

// The price the customer actually pays — used consistently by cart/order services
// instead of duplicating the "pick discountPrice if present" check everywhere. For a food
// WITH variants this is only a display figure ("from ₹x", the cheapest available variant) —
// unitPriceFor() in pricing.service.js is what a cart/order line is actually charged.
foodItemSchema.methods.effectivePrice = function effectivePrice() {
  if (this.variants && this.variants.length > 0) {
    const available = this.variants.filter((v) => v.isAvailable);
    const prices = (available.length > 0 ? available : this.variants).map((v) => (v.discountPrice != null ? v.discountPrice : v.price));
    return Math.min(...prices);
  }
  return this.discountPrice != null ? this.discountPrice : this.price;
};

// Computed, not stored: the price to SHOW on a card before any variant is chosen (for a food
// with variants, the cheapest available one; otherwise the usual discount/base price). Never
// used to charge — unitPriceFor() in pricing.service.js is authoritative for that. Named
// differently from the effectivePrice() method above so both can coexist (Mongoose keeps
// methods and virtuals in separate namespaces, but readers would otherwise expect one name
// to mean one thing).
foodItemSchema.virtual('displayPrice').get(function getDisplayPrice() {
  return this.effectivePrice();
});
foodItemSchema.set('toJSON', { virtuals: true });
foodItemSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('FoodItem', foodItemSchema);
