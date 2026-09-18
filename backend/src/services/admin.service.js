const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');
const { ORDER_STATUS } = require('../utils/constants');

// Platform-wide stats (unscoped) — the admin equivalent of Phase 9's
// per-restaurant dashboard.service.js. Revenue is delivered-orders-only, same
// definition as the owner dashboard, for consistency between the two.
async function getDashboardStats() {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const [totalUsers, totalRestaurants, totalOrders, pendingOrders, deliveredAgg, statusCounts, dailyCounts] =
    await Promise.all([
      User.countDocuments({}),
      Restaurant.countDocuments({}),
      Order.countDocuments({}),
      Order.countDocuments({ orderStatus: ORDER_STATUS.PENDING }),
      Order.aggregate([
        { $match: { orderStatus: ORDER_STATUS.DELIVERED } },
        { $group: { _id: null, revenue: { $sum: '$totalAmount' } } },
      ]),
      Order.aggregate([{ $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      ]),
    ]);

  const revenue = deliveredAgg[0]?.revenue || 0;
  const deliveredOrders = statusCounts.find((s) => s._id === ORDER_STATUS.DELIVERED)?.count || 0;

  const statusBreakdown = Object.values(ORDER_STATUS).map((status) => ({
    status,
    count: statusCounts.find((s) => s._id === status)?.count || 0,
  }));

  const dailyMap = new Map(dailyCounts.map((d) => [d._id, d.count]));
  const last7Days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    last7Days.push({ date: key, count: dailyMap.get(key) || 0 });
  }

  return { totalUsers, totalRestaurants, totalOrders, pendingOrders, deliveredOrders, revenue, statusBreakdown, last7Days };
}

async function listUsers(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: re }, { email: re }];
  }
  if (query.role) filter.role = query.role;

  const [items, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function setUserActive(id, isActive) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  user.isActive = isActive;
  await user.save();
  return user;
}

async function listRestaurantsForAdmin(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.search) filter.name = new RegExp(escapeRegex(query.search), 'i');
  if (query.isApproved !== undefined) filter.isApproved = query.isApproved === 'true';
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';

  const [items, total] = await Promise.all([
    Restaurant.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('owner', 'name email'),
    Restaurant.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function approveRestaurant(id) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  restaurant.isApproved = true;
  await restaurant.save();
  return restaurant;
}

async function setRestaurantActive(id, isActive) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  restaurant.isActive = isActive;
  await restaurant.save();
  return restaurant;
}

module.exports = {
  getDashboardStats,
  listUsers,
  setUserActive,
  listRestaurantsForAdmin,
  approveRestaurant,
  setRestaurantActive,
};
