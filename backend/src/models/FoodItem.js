const mongoose = require('mongoose');

const addonSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
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
  },
  { timestamps: true }
);

foodItemSchema.index({ name: 'text', description: 'text' });
foodItemSchema.index({ restaurant: 1, category: 1 });

// The price the customer actually pays — used consistently by cart/order services
// instead of duplicating the "pick discountPrice if present" check everywhere.
foodItemSchema.methods.effectivePrice = function effectivePrice() {
  return this.discountPrice != null ? this.discountPrice : this.price;
};

module.exports = mongoose.model('FoodItem', foodItemSchema);
