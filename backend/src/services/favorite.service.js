const Favorite = require('../models/Favorite');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');

async function listFavorites(userId) {
  const favorites = await Favorite.find({ user: userId }).sort('-createdAt').populate('restaurant');
  return favorites.map((f) => f.restaurant).filter(Boolean);
}

async function addFavorite(userId, restaurantId) {
  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  // Idempotent: favoriting an already-favorited restaurant just returns the
  // existing record rather than erroring on the unique index.
  const existing = await Favorite.findOne({ user: userId, restaurant: restaurantId });
  if (existing) return existing;

  return Favorite.create({ user: userId, restaurant: restaurantId });
}

async function removeFavorite(userId, restaurantId) {
  await Favorite.deleteOne({ user: userId, restaurant: restaurantId });
}

module.exports = { listFavorites, addFavorite, removeFavorite };
