const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const orderService = require('../services/order.service');

const createOrder = asyncHandler(async (req, res) => {
  const order = await orderService.createOrder(req.user, req.body);
  res.status(201).json(new ApiResponse(201, 'Order placed successfully', { order }));
});

const listOrders = asyncHandler(async (req, res) => {
  const { items, pagination } = await orderService.listOrdersForUser(req.user, req.query);
  res.json(new ApiResponse(200, 'Orders fetched', { orders: items, pagination }));
});

const getOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderById(req.user, req.params.id);
  res.json(new ApiResponse(200, 'Order fetched', { order }));
});

const updateStatus = asyncHandler(async (req, res) => {
  const order = await orderService.updateOrderStatus(req.user, req.params.id, req.body.status);
  res.json(new ApiResponse(200, 'Order status updated', { order }));
});

const cancelOrder = asyncHandler(async (req, res) => {
  const order = await orderService.cancelOrder(req.user, req.params.id, req.body.reason);
  res.json(new ApiResponse(200, 'Order cancelled', { order }));
});

const verifyPayment = asyncHandler(async (req, res) => {
  const order = await orderService.verifyOnlinePayment(req.user, req.params.id, req.body);
  res.json(new ApiResponse(200, 'Payment verified', { order }));
});

module.exports = { createOrder, listOrders, getOrder, updateStatus, cancelOrder, verifyPayment };
