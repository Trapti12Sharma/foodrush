const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const categoryService = require('../services/foodCategory.service');

const list = asyncHandler(async (req, res) => {
  if (!req.query.restaurant) throw ApiError.badRequest('restaurant query parameter is required');
  const categories = await categoryService.listByRestaurant(req.query.restaurant, req.user);
  res.json(new ApiResponse(200, 'Categories fetched', { categories }));
});

const getById = asyncHandler(async (req, res) => {
  const category = await categoryService.getCategoryById(req.params.id);
  res.json(new ApiResponse(200, 'Category fetched', { category }));
});

const create = asyncHandler(async (req, res) => {
  const category = await categoryService.createCategory(req.user, req.body);
  res.status(201).json(new ApiResponse(201, 'Category created', { category }));
});

const update = asyncHandler(async (req, res) => {
  const category = await categoryService.updateCategory(req.params.id, req.user, req.body);
  res.json(new ApiResponse(200, 'Category updated', { category }));
});

const remove = asyncHandler(async (req, res) => {
  await categoryService.deleteCategory(req.params.id, req.user);
  res.json(new ApiResponse(200, 'Category deleted'));
});

module.exports = { list, getById, create, update, remove };
