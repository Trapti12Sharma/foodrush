const Restaurant = require('../models/Restaurant');
const Order = require('../models/Order');
const ApiError = require('../utils/ApiError');
const { assertOwnerOrAdmin } = require('../utils/ownership');
const { ORDER_STATUS } = require('../utils/constants');

// "Revenue" is defined as the sum of totalAmount across DELIVERED orders only —
// i.e. money actually earned, not merely placed (excludes pending/cancelled/
// rejected orders that never completed).
async function getRestaurantDashboard(requester, restaurantId) {
  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only view your own restaurant dashboard');

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [totalOrders, pendingOrders, todayOrders, deliveredAgg] = await Promise.all([
    Order.countDocuments({ restaurant: restaurant._id }),
    Order.countDocuments({ restaurant: restaurant._id, orderStatus: ORDER_STATUS.PENDING }),
    Order.countDocuments({ restaurant: restaurant._id, createdAt: { $gte: startOfToday } }),
    Order.aggregate([
      { $match: { restaurant: restaurant._id, orderStatus: ORDER_STATUS.DELIVERED } },
      { $group: { _id: null, count: { $sum: 1 }, revenue: { $sum: '$totalAmount' } } },
    ]),
  ]);

  const delivered = deliveredAgg[0] || { count: 0, revenue: 0 };

  return {
    todayOrders,
    totalOrders,
    pendingOrders,
    deliveredOrders: delivered.count,
    revenue: delivered.revenue,
  };
}

module.exports = { getRestaurantDashboard };
