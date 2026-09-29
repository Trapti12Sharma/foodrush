const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const analyticsService = require('../services/analytics.service');
const { parseDateRange } = require('../utils/dateRange');

// Every handler parses the date range the same way, through the one shared
// parser — an endpoint quietly interpreting "last7days" differently from its
// neighbour is exactly what utils/dateRange.js exists to prevent. An invalid
// range throws before any aggregation runs.

const getOverview = asyncHandler(async (req, res) => {
  const data = await analyticsService.getOverview(parseDateRange(req.query));
  res.json(new ApiResponse(200, 'Analytics overview fetched', data));
});

const getSales = asyncHandler(async (req, res) => {
  const data = await analyticsService.getSales(parseDateRange(req.query), null);
  res.json(new ApiResponse(200, 'Sales analytics fetched', data));
});

const getOrders = asyncHandler(async (req, res) => {
  const data = await analyticsService.getOrders(parseDateRange(req.query), null);
  res.json(new ApiResponse(200, 'Order analytics fetched', data));
});

const getCustomers = asyncHandler(async (req, res) => {
  const data = await analyticsService.getCustomers(parseDateRange(req.query));
  res.json(new ApiResponse(200, 'Customer analytics fetched', data));
});

const getRestaurants = asyncHandler(async (req, res) => {
  const data = await analyticsService.getRestaurants(parseDateRange(req.query), {
    limit: req.query.limit,
    sort: req.query.sort,
  });
  res.json(new ApiResponse(200, 'Restaurant analytics fetched', data));
});

const getFood = asyncHandler(async (req, res) => {
  const data = await analyticsService.getFood(parseDateRange(req.query), null, { limit: req.query.limit });
  res.json(new ApiResponse(200, 'Food analytics fetched', data));
});

const getDelivery = asyncHandler(async (req, res) => {
  const data = await analyticsService.getDelivery(parseDateRange(req.query));
  res.json(new ApiResponse(200, 'Delivery analytics fetched', data));
});

const getPayments = asyncHandler(async (req, res) => {
  const data = await analyticsService.getPayments(parseDateRange(req.query));
  res.json(new ApiResponse(200, 'Payment analytics fetched', data));
});

const getCoupons = asyncHandler(async (req, res) => {
  const data = await analyticsService.getCoupons(parseDateRange(req.query));
  res.json(new ApiResponse(200, 'Coupon analytics fetched', data));
});

// Owner-scoped. The restaurant id in the path is only a lookup key — ownership
// is re-derived from req.user against the database inside the service, so a
// forged id gets a 403/404, never someone else's numbers.
const getRestaurantAnalytics = asyncHandler(async (req, res) => {
  const data = await analyticsService.getRestaurantAnalytics(req.user, req.params.id, parseDateRange(req.query), {
    limit: req.query.limit,
  });
  res.json(new ApiResponse(200, 'Restaurant analytics fetched', data));
});

module.exports = {
  getOverview,
  getSales,
  getOrders,
  getCustomers,
  getRestaurants,
  getFood,
  getDelivery,
  getPayments,
  getCoupons,
  getRestaurantAnalytics,
};
