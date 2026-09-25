const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const notificationService = require('./notification.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');
const { ORDER_STATUS, RESTAURANT_KYC_STATUS, NOTIFICATION_TYPE } = require('../utils/constants');
const { PERMISSIONS, hasPermission, isStaffRole } = require('../utils/permissions');

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
      Order.countDocuments({ orderStatus: ORDER_STATUS.PLACED }),
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

// Privilege guards: nobody can lock themselves out by accident, and only someone
// who may manage admins (SUPER_ADMIN) can enable/disable a staff account, so an
// ADMIN can never disable the SUPER_ADMIN above them.
async function setUserActive(id, isActive, actor) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  if (actor && user._id.toString() === actor._id.toString()) {
    throw ApiError.badRequest('You cannot change the status of your own account');
  }
  if (actor && isStaffRole(user.role) && !hasPermission(actor, PERMISSIONS.ADMINS_MANAGE)) {
    throw ApiError.forbidden('Only a super admin can change the status of a staff account');
  }
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
  if (query.kycStatus) filter.kycStatus = query.kycStatus;

  const [items, total] = await Promise.all([
    Restaurant.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('owner', 'name email'),
    Restaurant.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

// M14 — approving now also resolves the KYC review in the same action (mirrors
// deliveryPartnerService.approveKyc combining kycStatus + accountStatus in one
// step): a restaurant must have actually submitted its business documents
// first. isApproved is otherwise unaffected in every other way — a restaurant
// resubmitting KYC later (e.g. renewing a licence) never has this re-checked
// against its already-live status; that only happens on THIS explicit action.
async function approveRestaurant(id, admin) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  if (restaurant.kycStatus !== RESTAURANT_KYC_STATUS.SUBMITTED) {
    throw ApiError.badRequest(`This restaurant's KYC is "${restaurant.kycStatus}" — documents must be submitted (and not already reviewed) before it can be approved`);
  }
  restaurant.isApproved = true;
  restaurant.kycStatus = RESTAURANT_KYC_STATUS.VERIFIED;
  restaurant.kycRejectionReason = null;
  restaurant.kycReviewedAt = new Date();
  restaurant.kycReviewedBy = admin ? admin._id : null;
  await restaurant.save();

  await notificationService.notify({
    recipient: restaurant.owner,
    type: NOTIFICATION_TYPE.RESTAURANT_KYC_VERIFIED,
    data: { restaurantId: restaurant._id, restaurantName: restaurant.name },
    eventKey: `RESTAURANT:${restaurant._id}:KYC_VERIFIED:${restaurant.owner}`,
  });

  return restaurant;
}

// M14 — mirrors deliveryPartnerService.rejectKyc: only valid from SUBMITTED, a
// reason is required and shown back to the owner. isApproved/isActive are
// untouched — an already-live restaurant whose KYC renewal is rejected stays
// live; only the paperwork trail records the rejection (see the model's own
// comment on why these are deliberately decoupled).
async function rejectRestaurantKyc(id, admin, reason) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  if (restaurant.kycStatus !== RESTAURANT_KYC_STATUS.SUBMITTED) {
    throw ApiError.badRequest(`Cannot reject KYC from status "${restaurant.kycStatus}"`);
  }
  restaurant.kycStatus = RESTAURANT_KYC_STATUS.REJECTED;
  restaurant.kycRejectionReason = reason;
  restaurant.kycReviewedAt = new Date();
  restaurant.kycReviewedBy = admin ? admin._id : null;
  await restaurant.save();

  await notificationService.notify({
    recipient: restaurant.owner,
    type: NOTIFICATION_TYPE.RESTAURANT_KYC_REJECTED,
    data: { restaurantId: restaurant._id, restaurantName: restaurant.name, reason },
    eventKey: `RESTAURANT:${restaurant._id}:KYC_REJECTED:${restaurant.owner}:${restaurant.kycReviewedAt.getTime()}`,
  });

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
  rejectRestaurantKyc,
  setRestaurantActive,
};
