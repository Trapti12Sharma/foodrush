const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const adminService = require('../services/admin.service');
const orderService = require('../services/order.service');

const getDashboard = asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  res.json(new ApiResponse(200, 'Platform dashboard fetched', stats));
});

const listUsers = asyncHandler(async (req, res) => {
  const { items, pagination } = await adminService.listUsers(req.query);
  res.json(new ApiResponse(200, 'Users fetched', { users: items, pagination }));
});

const setUserActive = asyncHandler(async (req, res) => {
  const user = await adminService.setUserActive(req.params.id, req.body.isActive);
  res.json(new ApiResponse(200, 'User updated', { user }));
});

const listRestaurants = asyncHandler(async (req, res) => {
  const { items, pagination } = await adminService.listRestaurantsForAdmin(req.query);
  res.json(new ApiResponse(200, 'Restaurants fetched', { restaurants: items, pagination }));
});

const approveRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await adminService.approveRestaurant(req.params.id);
  res.json(new ApiResponse(200, 'Restaurant approved', { restaurant }));
});

const setRestaurantActive = asyncHandler(async (req, res) => {
  const restaurant = await adminService.setRestaurantActive(req.params.id, req.body.isActive);
  res.json(new ApiResponse(200, 'Restaurant updated', { restaurant }));
});

// Admin sees every order — order.service.listOrdersForUser already returns an
// unscoped filter for role ADMIN, so this just reuses it under /api/admin.
const listOrders = asyncHandler(async (req, res) => {
  const { items, pagination } = await orderService.listOrdersForUser(req.user, req.query);
  res.json(new ApiResponse(200, 'Orders fetched', { orders: items, pagination }));
});

module.exports = { getDashboard, listUsers, setUserActive, listRestaurants, approveRestaurant, setRestaurantActive, listOrders };
