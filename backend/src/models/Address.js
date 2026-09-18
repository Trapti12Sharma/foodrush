const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    label: {
      type: String,
      trim: true,
      default: 'Home',
    },
    addressLine: {
      type: String,
      required: [true, 'Address line is required'],
      trim: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    pincode: {
      type: String,
      required: [true, 'Pincode is required'],
      trim: true,
    },
    latitude: Number,
    longitude: Number,
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Only one default address per user; when a new default is set, the service layer
// (addresses.service.js, Phase 4) clears the previous default in the same transaction.
addressSchema.statics.clearDefaultForUser = function clearDefaultForUser(userId, exceptId) {
  return this.updateMany(
    { user: userId, _id: { $ne: exceptId }, isDefault: true },
    { $set: { isDefault: false } }
  );
};

module.exports = mongoose.model('Address', addressSchema);
