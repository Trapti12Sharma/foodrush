const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const reviewService = require('../services/review.service');
const auditService = require('../services/audit.service');

const createReview = asyncHandler(async (req, res) => {
  const review = await reviewService.createReview(req.user, req.body);
  await auditService.record({
    req,
    action: 'review.create',
    entityType: 'Review',
    entityId: review._id,
    metadata: { restaurant: review.restaurant.toString(), order: review.order.toString(), rating: review.rating },
  });
  res.status(201).json(new ApiResponse(201, 'Review submitted for moderation', { review }));
});

const listForRestaurant = asyncHandler(async (req, res) => {
  const { items, pagination } = await reviewService.listForRestaurant(req.params.id, req.query, req.user);
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

const reportReview = asyncHandler(async (req, res) => {
  const review = await reviewService.createReport(req.user, req.params.id, req.body.reason);
  await auditService.record({
    req,
    action: 'review.report',
    entityType: 'Review',
    entityId: review._id,
    metadata: { reason: req.body.reason, reportCount: review.reportCount },
  });
  res.status(201).json(new ApiResponse(201, 'Review reported'));
});

module.exports = { createReview, listForRestaurant, updateReview, deleteReview, reportReview };
