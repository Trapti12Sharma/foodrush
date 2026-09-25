const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const restaurantService = require('../services/restaurant.service');

const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await restaurantService.listPublicRestaurants(req.query);
  res.json(new ApiResponse(200, 'Restaurants fetched', { restaurants: items, pagination }));
});

const listMine = asyncHandler(async (req, res) => {
  const restaurants = await restaurantService.listMyRestaurants(req.user);
  res.json(new ApiResponse(200, 'Your restaurants', { restaurants }));
});

const getById = asyncHandler(async (req, res) => {
  const restaurant = await restaurantService.getRestaurantById(req.params.id, req.user);
  res.json(new ApiResponse(200, 'Restaurant fetched', { restaurant }));
});

const create = asyncHandler(async (req, res) => {
  const restaurant = await restaurantService.createRestaurant(req.user, req.body);
  res
    .status(201)
    .json(new ApiResponse(201, 'Restaurant created and pending admin approval', { restaurant }));
});

const update = asyncHandler(async (req, res) => {
  const restaurant = await restaurantService.updateRestaurant(req.params.id, req.user, req.body);
  res.json(new ApiResponse(200, 'Restaurant updated', { restaurant }));
});

const remove = asyncHandler(async (req, res) => {
  await restaurantService.deactivateRestaurant(req.params.id, req.user);
  res.json(new ApiResponse(200, 'Restaurant deactivated'));
});

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');
  const restaurant = await restaurantService.uploadRestaurantImage(req.params.id, req.params.type, req.user, req.file);
  res.status(201).json(new ApiResponse(201, 'Image uploaded', { restaurant }));
});

const deleteImage = asyncHandler(async (req, res) => {
  const restaurant = await restaurantService.deleteRestaurantImage(req.params.id, req.params.type, req.user);
  res.json(new ApiResponse(200, 'Image deleted', { restaurant }));
});

module.exports = { list, listMine, getById, create, update, remove, uploadImage, deleteImage };
