const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const foodService = require('../services/foodItem.service');

const list = asyncHandler(async (req, res) => {
  const { items, pagination } = await foodService.listFoods(req.query, req.user);
  res.json(new ApiResponse(200, 'Food items fetched', { foods: items, pagination }));
});

const getById = asyncHandler(async (req, res) => {
  const food = await foodService.getFoodById(req.params.id, req.user);
  res.json(new ApiResponse(200, 'Food item fetched', { food }));
});

const create = asyncHandler(async (req, res) => {
  const food = await foodService.createFood(req.user, req.body);
  res.status(201).json(new ApiResponse(201, 'Food item created', { food }));
});

const update = asyncHandler(async (req, res) => {
  const food = await foodService.updateFood(req.params.id, req.user, req.body);
  res.json(new ApiResponse(200, 'Food item updated', { food }));
});

const remove = asyncHandler(async (req, res) => {
  await foodService.deleteFood(req.params.id, req.user);
  res.json(new ApiResponse(200, 'Food item deleted'));
});

module.exports = { list, getById, create, update, remove };
