const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const favoriteService = require('../services/favorite.service');

const list = asyncHandler(async (req, res) => {
  const restaurants = await favoriteService.listFavorites(req.user._id);
  res.json(new ApiResponse(200, 'Favorites fetched', { restaurants }));
});

const add = asyncHandler(async (req, res) => {
  await favoriteService.addFavorite(req.user._id, req.params.restaurantId);
  res.status(201).json(new ApiResponse(201, 'Added to favorites'));
});

const remove = asyncHandler(async (req, res) => {
  await favoriteService.removeFavorite(req.user._id, req.params.restaurantId);
  res.json(new ApiResponse(200, 'Removed from favorites'));
});

module.exports = { list, add, remove };
