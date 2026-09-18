const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const reviewService = require('../services/review.service');

const createReview = asyncHandler(async (req, res) => {
  const review = await reviewService.createReview(req.user, req.body);
  res.status(201).json(new ApiResponse(201, 'Review submitted', { review }));
});

const listForRestaurant = asyncHandler(async (req, res) => {
  const { items, pagination } = await reviewService.listForRestaurant(req.params.id, req.query);
  res.json(new ApiResponse(200, 'Reviews fetched', { reviews: items, pagination }));
});

const updateReview = asyncHandler(async (req, res) => {
  const review = await reviewService.updateReview(req.user, req.params.id, req.body);
  res.json(new ApiResponse(200, 'Review updated', { review }));
});

const deleteReview = asyncHandler(async (req, res) => {
  await reviewService.deleteReview(req.user, req.params.id);
  res.json(new ApiResponse(200, 'Review deleted'));
});

module.exports = { createReview, listForRestaurant, updateReview, deleteReview };
