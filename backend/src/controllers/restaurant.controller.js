const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
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

module.exports = { list, listMine, getById, create, update, remove };
