const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const notificationService = require('../services/notification.service');

// Every handler is scoped to req.user — identity always comes from
// authenticateUser, never a client-supplied recipient/user id (see
// notification.service.js, which enforces the same rule at the data layer).
const listMyNotifications = asyncHandler(async (req, res) => {
  const { items, pagination } = await notificationService.getUserNotifications(req.user, req.query);
  res.json(new ApiResponse(200, 'Notifications fetched', { notifications: items, pagination }));
});

const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user);
  res.json(new ApiResponse(200, 'Unread count fetched', { count }));
});

const getMyNotification = asyncHandler(async (req, res) => {
  const notification = await notificationService.getById(req.user, req.params.id);
  res.json(new ApiResponse(200, 'Notification fetched', { notification }));
});

const markAsRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(req.user, req.params.id);
  res.json(new ApiResponse(200, 'Notification marked read', { notification }));
});

const markAllAsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllAsRead(req.user);
  res.json(new ApiResponse(200, 'All notifications marked read', result));
});

module.exports = { listMyNotifications, getUnreadCount, getMyNotification, markAsRead, markAllAsRead };
