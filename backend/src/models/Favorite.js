const mongoose = require('mongoose');

// Not in the original model list, but required to back the /api/favorites endpoints
// (section 14) and the User.favorites virtual — a plain join collection rather than
// an array on User so favoriting is O(1) and doesn't require rewriting a growing array.
const favoriteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
  },
  { timestamps: true }
);

favoriteSchema.index({ user: 1, restaurant: 1 }, { unique: true });

module.exports = mongoose.model('Favorite', favoriteSchema);
