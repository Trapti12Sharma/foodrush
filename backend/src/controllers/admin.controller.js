const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const adminService = require('../services/admin.service');
const orderService = require('../services/order.service');
const auditService = require('../services/audit.service');
const refundService = require('../services/refund.service');
const Order = require('../models/Order');

const getDashboard = asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  res.json(new ApiResponse(200, 'Platform dashboard fetched', stats));
});

const listUsers = asyncHandler(async (req, res) => {
  const { items, pagination } = await adminService.listUsers(req.query);
  res.json(new ApiResponse(200, 'Users fetched', { users: items, pagination }));
});

const setUserActive = asyncHandler(async (req, res) => {
  const user = await adminService.setUserActive(req.params.id, req.body.isActive, req.user);
  await auditService.record({
    req,
    action: 'user.set_active',
    entityType: 'User',
    entityId: user._id,
    metadata: { isActive: user.isActive, targetRole: user.role },
  });
  res.json(new ApiResponse(200, 'User updated', { user }));
});

const listRestaurants = asyncHandler(async (req, res) => {
  const { items, pagination } = await adminService.listRestaurantsForAdmin(req.query);
  res.json(new ApiResponse(200, 'Restaurants fetched', { restaurants: items, pagination }));
});

const approveRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await adminService.approveRestaurant(req.params.id);
  await auditService.record({
    req,
    action: 'restaurant.approve',
    entityType: 'Restaurant',
    entityId: restaurant._id,
    metadata: { name: restaurant.name },
  });
  res.json(new ApiResponse(200, 'Restaurant approved', { restaurant }));
});

const setRestaurantActive = asyncHandler(async (req, res) => {
  const restaurant = await adminService.setRestaurantActive(req.params.id, req.body.isActive);
  await auditService.record({
    req,
    action: 'restaurant.set_active',
    entityType: 'Restaurant',
    entityId: restaurant._id,
    metadata: { name: restaurant.name, isActive: restaurant.isActive },
  });
  res.json(new ApiResponse(200, 'Restaurant updated', { restaurant }));
});

// Staff with orders:read_all see every order; order.service.listOrdersForUser
// already returns an unscoped filter for them, so this just reuses it under /api/admin.
const listOrders = asyncHandler(async (req, res) => {
  const { items, pagination } = await orderService.listOrdersForUser(req.user, req.query);
  res.json(new ApiResponse(200, 'Orders fetched', { orders: items, pagination }));
});

const listAuditLogs = asyncHandler(async (req, res) => {
  const { items, pagination } = await auditService.listLogs(req.query);
  res.json(new ApiResponse(200, 'Audit logs fetched', { logs: items, pagination }));
});

const refundOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const refund = await refundService.initiateRefund(order, {
    reason: req.body.reason || 'admin_initiated',
    actor: req.user,
    amount: req.body.amount,
  });
  await auditService.record({
    req,
    action: 'order.refund',
    entityType: 'Order',
    entityId: order._id,
    metadata: { orderNumber: order.orderNumber, amount: refund.amount, status: refund.status, refundId: refund._id },
  });
  res.json(new ApiResponse(200, 'Refund initiated', { refund }));
});

const listRefunds = asyncHandler(async (req, res) => {
  const { items, pagination } = await refundService.listRefunds(req.query);
  res.json(new ApiResponse(200, 'Refunds fetched', { refunds: items, pagination }));
});

module.exports = {
  getDashboard,
  listUsers,
  setUserActive,
  listRestaurants,
  approveRestaurant,
  setRestaurantActive,
  listOrders,
  listAuditLogs,
  refundOrder,
  listRefunds,
};
