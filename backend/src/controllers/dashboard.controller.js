const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const dashboardService = require('../services/dashboard.service');

const getRestaurantDashboard = asyncHandler(async (req, res) => {
  const stats = await dashboardService.getRestaurantDashboard(req.user, req.params.id);
  res.json(new ApiResponse(200, 'Dashboard stats fetched', stats));
});

module.exports = { getRestaurantDashboard };
