const mongoose = require('mongoose');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const Restaurant = require('../models/Restaurant');
const Review = require('../models/Review');
const User = require('../models/User');
const DeliveryPartner = require('../models/DeliveryPartner');
const DeliveryAssignment = require('../models/DeliveryAssignment');
const DeliveryEarning = require('../models/DeliveryEarning');
const DeliverySettlement = require('../models/DeliverySettlement');
const CouponUsage = require('../models/CouponUsage');
const Coupon = require('../models/Coupon');
const ApiError = require('../utils/ApiError');
const { assertOwnerOrAdmin } = require('../utils/ownership');
const { PERMISSIONS } = require('../utils/permissions');
const { rangeFilter, eachUtcDay } = require('../utils/dateRange');
const {
  ROLES,
  ORDER_STATUS,
  PAYMENT_METHODS,
  PAYMENT_ATTEMPT_STATUS,
  REFUND_STATUS,
  REVIEW_MODERATION_STATUS,
  DELIVERY_ASSIGNMENT_STATUS,
  DELIVERY_ACCOUNT_STATUS,
  DELIVERY_EARNING_STATUS,
  DELIVERY_SETTLEMENT_STATUS,
} = require('../utils/constants');

// ---------------------------------------------------------------------------
// FINANCIAL DEFINITIONS (M16)
//
// These are deliberately derived from what the codebase ALREADY treats as
// money earned — the pre-M16 admin and owner dashboards both define "revenue"
// as the sum of Order.totalAmount over DELIVERED orders — rather than inventing
// new accounting. The one necessary refinement:
//
//   A FULFILLED order is one that actually reached DELIVERED. It either still
//   IS delivered, or it has since moved to REFUND_PENDING/REFUNDED (a refund
//   moves orderStatus off DELIVERED — see refund.service.js). We detect the
//   latter through statusHistory, which records every transition including the
//   DELIVERED one (order.service.js + deliveryAssignment.service.js both push
//   it). This matters because REFUND_PENDING/REFUNDED is also reachable from
//   CANCELLED/REJECTED — an order cancelled before delivery and then refunded
//   was never a sale, and must not be counted as one.
//
//   grossSales  = Σ totalAmount over fulfilled orders created in range.
//                 Includes orders later refunded, so the figure for a past
//                 period does not silently shrink when a refund is processed.
//   discounts   = Σ discount over those same orders. Informational: it is
//                 ALREADY deducted from totalAmount, so it is never subtracted
//                 again.
//   refunds     = Σ amount of COMPLETED refunds belonging to those orders.
//                 Only COMPLETED — money actually returned. PENDING/PROCESSING
//                 refunds are reported separately and never netted off.
//   netSales    = grossSales − refunds. No double counting: gross includes the
//                 refunded orders precisely so this subtraction is correct once.
//   AOV         = grossSales / fulfilled order count.
//
// Sales are attributed to the order's createdAt (when the customer placed it),
// which is the dimension the existing dashboard trend already uses — not
// delivery date. All day bucketing is UTC (see utils/dateRange.js).
// ---------------------------------------------------------------------------

// Matches orders that genuinely reached DELIVERED at some point.
const FULFILLED_SALE_MATCH = Object.freeze({
  $or: [{ orderStatus: ORDER_STATUS.DELIVERED }, { 'statusHistory.status': ORDER_STATUS.DELIVERED }],
});

// Statuses that mean the order never became a sale.
const FAILED_ORDER_STATUSES = Object.freeze([ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED]);

const DAY_KEY = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };

function round2(value) {
  return Math.round((value || 0) * 100) / 100;
}

// A single item line's money, replicating pricing.service.js#lineTotal exactly:
// (unit price + addons) × quantity. Kept identical on purpose — food analytics
// disagreeing with what the customer was actually charged would be a bug.
const ITEM_LINE_TOTAL = {
  $multiply: [{ $add: ['$items.price', { $ifNull: [{ $sum: '$items.addons.price' }, 0] }] }, '$items.quantity'],
};

// Owner-scoped calls pass restaurantIds; admin calls pass nothing (platform-wide).
// Never built from a raw client value — see resolveOwnerScope below.
//
// The ids are cast to ObjectId explicitly because these filters feed aggregation
// pipelines, and $match does NOT apply Mongoose's schema casting the way find()
// does — a string id would match nothing and silently report zero sales rather
// than erroring. (The same hazard is called out in review.service.js's
// recalculateRestaurantRating.)
function toObjectIds(restaurantIds) {
  return (Array.isArray(restaurantIds) ? restaurantIds : [restaurantIds]).map((id) =>
    id instanceof mongoose.Types.ObjectId ? id : new mongoose.Types.ObjectId(String(id))
  );
}

function restaurantFilter(restaurantIds) {
  if (!restaurantIds) return {};
  return { restaurant: { $in: toObjectIds(restaurantIds) } };
}

// The same scope expressed against a refund's joined order document.
function joinedOrderRestaurantFilter(restaurantIds) {
  if (!restaurantIds) return {};
  return { 'orderDoc.restaurant': { $in: toObjectIds(restaurantIds) } };
}

function baseOrderMatch(range, restaurantIds) {
  return { ...rangeFilter(range), ...restaurantFilter(restaurantIds) };
}

// ---------------------------------------------------------------------------
// Ownership resolution — the ONLY place an owner's analytics scope comes from.
// The restaurant is loaded from the database and its stored `owner` compared
// against the AUTHENTICATED user; the id from the path is just a lookup key, so
// a forged one cannot widen anyone's scope (Phase 13/16: IDOR protection is
// mandatory). Uses the same assertOwnerOrAdmin helper — and the same permission
// — as the pre-existing /restaurants/:id/dashboard, so an owner sees only their
// own restaurant while platform staff holding restaurants:read_all can view any
// one, exactly as they already can on the sibling dashboard endpoint.
// ---------------------------------------------------------------------------
async function resolveOwnerScope(requester, restaurantId) {
  const restaurant = await Restaurant.findById(restaurantId).select('_id owner name rating totalReviews');
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(
    restaurant.owner,
    requester,
    'You can only view analytics for your own restaurant',
    PERMISSIONS.RESTAURANTS_READ_ALL
  );
  return restaurant;
}

// ---------------------------------------------------------------------------
// SALES
// ---------------------------------------------------------------------------
async function salesTotals(range, restaurantIds) {
  const match = { ...baseOrderMatch(range, restaurantIds), ...FULFILLED_SALE_MATCH };

  const [orderAgg, refundAgg] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          grossSales: { $sum: '$totalAmount' },
          discounts: { $sum: '$discount' },
          subtotal: { $sum: '$subtotal' },
          deliveryFees: { $sum: '$deliveryFee' },
          tax: { $sum: '$tax' },
        },
      },
    ]),
    // Rooted at Refund (a far smaller collection than Order) and joined up to
    // its order, rather than a per-order $lookup over every order in range.
    Refund.aggregate([
      { $match: { status: REFUND_STATUS.COMPLETED } },
      { $lookup: { from: Order.collection.name, localField: 'order', foreignField: '_id', as: 'orderDoc' } },
      { $unwind: '$orderDoc' },
      {
        $match: {
          ...(range && range.start ? { 'orderDoc.createdAt': { $gte: range.start, $lt: range.end } } : {}),
          ...joinedOrderRestaurantFilter(restaurantIds),
          $or: [
            { 'orderDoc.orderStatus': ORDER_STATUS.DELIVERED },
            { 'orderDoc.statusHistory.status': ORDER_STATUS.DELIVERED },
          ],
        },
      },
      { $group: { _id: null, refunds: { $sum: '$amount' }, refundCount: { $sum: 1 } } },
    ]),
  ]);

  const o = orderAgg[0] || { orders: 0, grossSales: 0, discounts: 0, subtotal: 0, deliveryFees: 0, tax: 0 };
  const r = refundAgg[0] || { refunds: 0, refundCount: 0 };
  const grossSales = round2(o.grossSales);
  const refunds = round2(r.refunds);

  return {
    orders: o.orders,
    grossSales,
    discounts: round2(o.discounts),
    refunds,
    refundedOrderCount: r.refundCount,
    netSales: round2(grossSales - refunds),
    averageOrderValue: o.orders ? round2(grossSales / o.orders) : 0,
    itemsSubtotal: round2(o.subtotal),
    deliveryFees: round2(o.deliveryFees),
    tax: round2(o.tax),
  };
}

// Day-by-day series over the same definitions, with zero-activity days present
// rather than missing (a gap in a chart reads as different dates, not as zero).
async function salesTrend(range, restaurantIds) {
  const days = eachUtcDay(range);
  if (days.length === 0) return [];

  const match = { ...baseOrderMatch(range, restaurantIds), ...FULFILLED_SALE_MATCH };

  const [orderRows, refundRows] = await Promise.all([
    Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: DAY_KEY,
          orders: { $sum: 1 },
          gross: { $sum: '$totalAmount' },
          discounts: { $sum: '$discount' },
        },
      },
    ]),
    Refund.aggregate([
      { $match: { status: REFUND_STATUS.COMPLETED } },
      { $lookup: { from: Order.collection.name, localField: 'order', foreignField: '_id', as: 'orderDoc' } },
      { $unwind: '$orderDoc' },
      {
        $match: {
          ...(range && range.start ? { 'orderDoc.createdAt': { $gte: range.start, $lt: range.end } } : {}),
          ...joinedOrderRestaurantFilter(restaurantIds),
          $or: [
            { 'orderDoc.orderStatus': ORDER_STATUS.DELIVERED },
            { 'orderDoc.statusHistory.status': ORDER_STATUS.DELIVERED },
          ],
        },
      },
      // Bucketed by the ORDER's day, not the refund's, so a day's refunds line
      // up with the same day's gross instead of drifting to whenever the refund
      // happened to be processed.
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$orderDoc.createdAt' } },
          refunds: { $sum: '$amount' },
        },
      },
    ]),
  ]);

  const orderMap = new Map(orderRows.map((row) => [row._id, row]));
  const refundMap = new Map(refundRows.map((row) => [row._id, row.refunds]));

  return days.map((date) => {
    const row = orderMap.get(date) || { orders: 0, gross: 0, discounts: 0 };
    const gross = round2(row.gross);
    const refunds = round2(refundMap.get(date) || 0);
    return {
      date,
      orders: row.orders,
      gross,
      discounts: round2(row.discounts),
      refunds,
      net: round2(gross - refunds),
    };
  });
}

async function getSales(range, restaurantIds) {
  const [summary, trend] = await Promise.all([salesTotals(range, restaurantIds), salesTrend(range, restaurantIds)]);
  return { range: describeRange(range), summary, trend };
}

// ---------------------------------------------------------------------------
// ORDERS
// ---------------------------------------------------------------------------
async function getOrders(range, restaurantIds) {
  const match = baseOrderMatch(range, restaurantIds);
  const days = eachUtcDay(range);

  const [statusRows, trendRows, fulfilled] = await Promise.all([
    Order.aggregate([{ $match: match }, { $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
    days.length ? Order.aggregate([{ $match: match }, { $group: { _id: DAY_KEY, orders: { $sum: 1 } } }]) : [],
    // Orders that reached DELIVERED — the completion numerator. Counted from the
    // same fulfilled definition sales uses, so the two sections agree.
    Order.countDocuments({ ...match, ...FULFILLED_SALE_MATCH }),
  ]);

  const byStatusMap = new Map(statusRows.map((row) => [row._id, row.count]));
  const total = statusRows.reduce((sum, row) => sum + row.count, 0);

  // Every status is listed, including zeroes — the same shape the existing
  // admin dashboard's statusBreakdown returns.
  const byStatus = Object.values(ORDER_STATUS).map((status) => ({
    status,
    count: byStatusMap.get(status) || 0,
  }));

  const cancelled = FAILED_ORDER_STATUSES.reduce((sum, status) => sum + (byStatusMap.get(status) || 0), 0);
  const trendMap = new Map(trendRows.map((row) => [row._id, row.orders]));

  return {
    range: describeRange(range),
    summary: {
      totalOrders: total,
      fulfilledOrders: fulfilled,
      cancelledOrders: byStatusMap.get(ORDER_STATUS.CANCELLED) || 0,
      rejectedOrders: byStatusMap.get(ORDER_STATUS.REJECTED) || 0,
      refundPendingOrders: byStatusMap.get(ORDER_STATUS.REFUND_PENDING) || 0,
      refundedOrders: byStatusMap.get(ORDER_STATUS.REFUNDED) || 0,
      inProgressOrders:
        total - fulfilled - cancelled - (byStatusMap.get(ORDER_STATUS.REFUND_PENDING) || 0) - (byStatusMap.get(ORDER_STATUS.REFUNDED) || 0),
      // Rates are null (not 0) with no orders — "no data" is not "0%".
      completionRate: total ? round2((fulfilled / total) * 100) : null,
      cancellationRate: total ? round2((cancelled / total) * 100) : null,
    },
    byStatus,
    trend: days.map((date) => ({ date, orders: trendMap.get(date) || 0 })),
  };
}

// ---------------------------------------------------------------------------
// CUSTOMERS (admin only)
//
// "Customer" is strictly role === CUSTOMER — staff, restaurant owners and
// delivery partners are never counted, even though only customers can place
// orders in the first place.
//
// active  = placed ≥1 order in range that was not cancelled/rejected
// repeat  = placed ≥2 such orders in range
// ---------------------------------------------------------------------------
async function getCustomers(range) {
  const validOrderMatch = { ...rangeFilter(range), orderStatus: { $nin: FAILED_ORDER_STATUSES } };

  const [totalCustomers, newCustomers, activityRows] = await Promise.all([
    User.countDocuments({ role: ROLES.CUSTOMER }),
    User.countDocuments({ role: ROLES.CUSTOMER, ...rangeFilter(range) }),
    Order.aggregate([
      { $match: validOrderMatch },
      { $group: { _id: '$user', orders: { $sum: 1 }, spend: { $sum: '$totalAmount' } } },
      {
        $group: {
          _id: null,
          activeCustomers: { $sum: 1 },
          repeatCustomers: { $sum: { $cond: [{ $gte: ['$orders', 2] }, 1, 0] } },
          orders: { $sum: '$orders' },
          spend: { $sum: '$spend' },
        },
      },
    ]),
  ]);

  const a = activityRows[0] || { activeCustomers: 0, repeatCustomers: 0, orders: 0, spend: 0 };

  return {
    range: describeRange(range),
    summary: {
      totalCustomers,
      newCustomers,
      activeCustomers: a.activeCustomers,
      repeatCustomers: a.repeatCustomers,
      ordersFromActiveCustomers: a.orders,
      averageOrdersPerActiveCustomer: a.activeCustomers ? round2(a.orders / a.activeCustomers) : null,
      averageSpendPerActiveCustomer: a.activeCustomers ? round2(a.spend / a.activeCustomers) : null,
      repeatCustomerRate: a.activeCustomers ? round2((a.repeatCustomers / a.activeCustomers) * 100) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// RESTAURANTS (admin only)
//
// Factual per-restaurant metrics, sorted by a whitelisted metric. No
// evaluative "best restaurant" scoring — sorting by order count or sales is a
// fact, a composite quality score would be an opinion this milestone has no
// business inventing.
// ---------------------------------------------------------------------------
const RESTAURANT_SORTS = Object.freeze({
  orders: 'orders',
  grossSales: 'grossSales',
  fulfilledOrders: 'fulfilledOrders',
  averageOrderValue: 'averageOrderValue',
  rating: 'rating',
  reviewCount: 'reviewCount',
});

async function getRestaurants(range, { limit = 20, sort = 'grossSales' } = {}) {
  const sortField = RESTAURANT_SORTS[sort] || RESTAURANT_SORTS.grossSales;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const rows = await Order.aggregate([
    { $match: rangeFilter(range) },
    {
      $group: {
        _id: '$restaurant',
        orders: { $sum: 1 },
        // A conditional sum keeps this to ONE pass over the matched orders
        // instead of a second aggregation for the fulfilled subset.
        fulfilledOrders: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$orderStatus', ORDER_STATUS.DELIVERED] },
                  { $in: [ORDER_STATUS.DELIVERED, { $ifNull: ['$statusHistory.status', []] }] },
                ],
              },
              1,
              0,
            ],
          },
        },
        grossSales: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $eq: ['$orderStatus', ORDER_STATUS.DELIVERED] },
                  { $in: [ORDER_STATUS.DELIVERED, { $ifNull: ['$statusHistory.status', []] }] },
                ],
              },
              '$totalAmount',
              0,
            ],
          },
        },
        discounts: { $sum: '$discount' },
        cancelledOrders: { $sum: { $cond: [{ $in: ['$orderStatus', FAILED_ORDER_STATUSES] }, 1, 0] } },
      },
    },
    {
      $addFields: {
        averageOrderValue: { $cond: [{ $gt: ['$fulfilledOrders', 0] }, { $divide: ['$grossSales', '$fulfilledOrders'] }, 0] },
      },
    },
    { $lookup: { from: Restaurant.collection.name, localField: '_id', foreignField: '_id', as: 'restaurant' } },
    { $unwind: '$restaurant' },
    {
      $project: {
        _id: 0,
        restaurantId: '$_id',
        name: '$restaurant.name',
        city: '$restaurant.city',
        isActive: '$restaurant.isActive',
        isApproved: '$restaurant.isApproved',
        rating: '$restaurant.rating',
        reviewCount: '$restaurant.totalReviews',
        orders: 1,
        fulfilledOrders: 1,
        cancelledOrders: 1,
        grossSales: { $round: ['$grossSales', 2] },
        discounts: { $round: ['$discounts', 2] },
        averageOrderValue: { $round: ['$averageOrderValue', 2] },
      },
    },
    { $sort: { [sortField]: -1, name: 1 } },
    { $limit: safeLimit },
  ]);

  const [totalRestaurants, activeRestaurants] = await Promise.all([
    Restaurant.countDocuments({}),
    Restaurant.countDocuments({ isActive: true, isApproved: true }),
  ]);

  return {
    range: describeRange(range),
    summary: { totalRestaurants, activeRestaurants, restaurantsWithOrders: rows.length },
    sortedBy: sortField,
    breakdown: rows,
  };
}

// ---------------------------------------------------------------------------
// FOOD / MENU
//
// Quantities and money come from the frozen item snapshots on FULFILLED orders
// only — a cart addition, a pending order or a cancelled order is not a sale.
//
// Deliberately NOT included: per-item rating/review counts. Reviews in this
// schema attach to a restaurant and an order (see models/Review.js), never to a
// food item, so a per-dish rating cannot be computed from real data — and
// inventing one is exactly what this milestone must not do.
// ---------------------------------------------------------------------------
async function getFood(range, restaurantIds, { limit = 20 } = {}) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const match = { ...baseOrderMatch(range, restaurantIds), ...FULFILLED_SALE_MATCH };

  const rows = await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: { food: '$items.food', name: '$items.name' },
        quantity: { $sum: '$items.quantity' },
        sales: { $sum: ITEM_LINE_TOTAL },
        // A set, then its size — an item appearing twice in one order (two
        // variants) must count as one order containing it, not two.
        orderIds: { $addToSet: '$_id' },
        restaurantIds: { $addToSet: '$restaurant' },
      },
    },
    {
      $project: {
        _id: 0,
        foodId: '$_id.food',
        name: '$_id.name',
        quantity: 1,
        sales: { $round: ['$sales', 2] },
        orderCount: { $size: '$orderIds' },
        restaurantId: { $arrayElemAt: ['$restaurantIds', 0] },
      },
    },
    { $sort: { quantity: -1, name: 1 } },
    { $limit: safeLimit },
  ]);

  return {
    range: describeRange(range),
    summary: {
      itemsSold: rows.reduce((sum, row) => sum + row.quantity, 0),
      distinctItems: rows.length,
    },
    breakdown: rows,
    note: 'Per-item ratings are not available: reviews attach to a restaurant and order, not to individual menu items.',
  };
}

// ---------------------------------------------------------------------------
// DELIVERY (admin only)
// ---------------------------------------------------------------------------
async function getDelivery(range) {
  const match = rangeFilter(range);

  const [statusRows, completionRows, earningRows, settlementRows, riderRows, activeRiders] = await Promise.all([
    DeliveryAssignment.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    // Average time from confirmed assignment to delivery. Only assignments that
    // actually carry BOTH timestamps are considered; one missing timestamp means
    // the metric is omitted for that row rather than estimated.
    DeliveryAssignment.aggregate([
      {
        $match: {
          ...match,
          status: DELIVERY_ASSIGNMENT_STATUS.COMPLETED,
          assignedAt: { $ne: null },
          completedAt: { $ne: null },
        },
      },
      {
        $group: {
          _id: null,
          measured: { $sum: 1 },
          totalMs: { $sum: { $subtract: ['$completedAt', '$assignedAt'] } },
        },
      },
    ]),
    DeliveryEarning.aggregate([
      { $match: rangeFilter(range, 'earnedAt') },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          gross: { $sum: '$grossAmount' },
          net: { $sum: '$netAmount' },
          settled: { $sum: { $cond: [{ $eq: ['$status', DELIVERY_EARNING_STATUS.SETTLED] }, '$netAmount', 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', DELIVERY_EARNING_STATUS.PENDING] }, '$netAmount', 0] } },
        },
      },
    ]),
    DeliverySettlement.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, netAmount: { $sum: '$netAmount' } } },
    ]),
    DeliveryEarning.aggregate([
      { $match: rangeFilter(range, 'earnedAt') },
      { $group: { _id: '$deliveryPartner', deliveries: { $sum: 1 }, net: { $sum: '$netAmount' } } },
      { $sort: { deliveries: -1 } },
      { $limit: 20 },
      { $lookup: { from: DeliveryPartner.collection.name, localField: '_id', foreignField: '_id', as: 'partner' } },
      { $unwind: '$partner' },
      {
        $project: {
          _id: 0,
          deliveryPartnerId: '$_id',
          // Rider's own operational name only — no phone, address or document data.
          name: '$partner.fullName',
          city: '$partner.city',
          deliveries: 1,
          netEarnings: { $round: ['$net', 2] },
        },
      },
    ]),
    DeliveryPartner.countDocuments({ accountStatus: DELIVERY_ACCOUNT_STATUS.ACTIVE }),
  ]);

  const statusMap = new Map(statusRows.map((row) => [row._id, row.count]));
  const completion = completionRows[0];
  const earnings = earningRows[0] || { count: 0, gross: 0, net: 0, settled: 0, pending: 0 };

  const byStatus = Object.values(DELIVERY_ASSIGNMENT_STATUS).map((status) => ({
    status,
    count: statusMap.get(status) || 0,
  }));

  const assignmentsCreated = statusRows.reduce((sum, row) => sum + row.count, 0);

  return {
    range: describeRange(range),
    summary: {
      assignmentsCreated,
      accepted: (statusMap.get(DELIVERY_ASSIGNMENT_STATUS.ACCEPTED) || 0) + (statusMap.get(DELIVERY_ASSIGNMENT_STATUS.ASSIGNED) || 0) + (statusMap.get(DELIVERY_ASSIGNMENT_STATUS.COMPLETED) || 0),
      completed: statusMap.get(DELIVERY_ASSIGNMENT_STATUS.COMPLETED) || 0,
      cancelled: statusMap.get(DELIVERY_ASSIGNMENT_STATUS.CANCELLED) || 0,
      rejected: statusMap.get(DELIVERY_ASSIGNMENT_STATUS.REJECTED) || 0,
      expired: statusMap.get(DELIVERY_ASSIGNMENT_STATUS.EXPIRED) || 0,
      activeDeliveryPartners: activeRiders,
      // null, not 0, when nothing in range carried both timestamps.
      averageCompletionMinutes: completion && completion.measured ? round2(completion.totalMs / completion.measured / 60000) : null,
      measuredCompletions: completion ? completion.measured : 0,
    },
    earnings: {
      earningRecords: earnings.count,
      grossEarnings: round2(earnings.gross),
      netEarnings: round2(earnings.net),
      settledEarnings: round2(earnings.settled),
      pendingEarnings: round2(earnings.pending),
    },
    settlements: Object.values(DELIVERY_SETTLEMENT_STATUS).map((status) => {
      const row = settlementRows.find((s) => s._id === status);
      return { status, count: row ? row.count : 0, netAmount: round2(row ? row.netAmount : 0) };
    }),
    byAssignmentStatus: byStatus,
    topDeliveryPartners: riderRows,
  };
}

// ---------------------------------------------------------------------------
// PAYMENTS & REFUNDS (admin only)
//
// Payment is one row per ONLINE ATTEMPT, not per order (see models/Payment.js),
// so "successful online payments" counts DISTINCT ORDERS that have a PAID
// attempt — a customer who failed once and retried successfully is one paid
// order, not two. Attempt counts are reported separately and clearly labelled.
// ---------------------------------------------------------------------------
async function getPayments(range) {
  const match = rangeFilter(range);

  const [attemptRows, paidOrderRows, codRows, refundRows] = await Promise.all([
    Payment.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
    Payment.aggregate([
      { $match: { ...match, status: PAYMENT_ATTEMPT_STATUS.PAID } },
      { $group: { _id: '$order', amount: { $max: '$amount' } } },
      { $group: { _id: null, paidOrders: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    Order.aggregate([
      { $match: { ...match, paymentMethod: PAYMENT_METHODS.COD } },
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } },
    ]),
    Refund.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
  ]);

  const attemptMap = new Map(attemptRows.map((row) => [row._id, row]));
  const paid = paidOrderRows[0] || { paidOrders: 0, amount: 0 };
  const cod = codRows[0] || { count: 0, amount: 0 };
  const refundMap = new Map(refundRows.map((row) => [row._id, row]));

  const attemptOf = (status) => attemptMap.get(status) || { count: 0, amount: 0 };
  const refundOf = (status) => refundMap.get(status) || { count: 0, amount: 0 };

  return {
    range: describeRange(range),
    online: {
      paidOrders: paid.paidOrders,
      paidAmount: round2(paid.amount),
      totalAttempts: attemptRows.reduce((sum, row) => sum + row.count, 0),
      createdAttempts: attemptOf(PAYMENT_ATTEMPT_STATUS.CREATED).count,
      paidAttempts: attemptOf(PAYMENT_ATTEMPT_STATUS.PAID).count,
      failedAttempts: attemptOf(PAYMENT_ATTEMPT_STATUS.FAILED).count,
    },
    cod: { orders: cod.count, amount: round2(cod.amount) },
    refunds: {
      total: refundRows.reduce((sum, row) => sum + row.count, 0),
      totalAmount: round2(refundRows.reduce((sum, row) => sum + row.amount, 0)),
      completed: refundOf(REFUND_STATUS.COMPLETED).count,
      completedAmount: round2(refundOf(REFUND_STATUS.COMPLETED).amount),
      pending: refundOf(REFUND_STATUS.PENDING).count,
      processing: refundOf(REFUND_STATUS.PROCESSING).count,
      failed: refundOf(REFUND_STATUS.FAILED).count,
    },
  };
}

// ---------------------------------------------------------------------------
// COUPONS (admin only) — read from CouponUsage, which has one row per
// (coupon, order) with a unique index on order, so a retried order write can
// never inflate a redemption count.
// ---------------------------------------------------------------------------
async function getCoupons(range) {
  const match = rangeFilter(range);

  const [totals, byCoupon] = await Promise.all([
    CouponUsage.aggregate([
      { $match: match },
      { $group: { _id: null, redemptions: { $sum: 1 }, discount: { $sum: '$discountAmount' }, customers: { $addToSet: '$user' } } },
      { $project: { _id: 0, redemptions: 1, discount: 1, customers: { $size: '$customers' } } },
    ]),
    CouponUsage.aggregate([
      { $match: match },
      { $group: { _id: '$coupon', redemptions: { $sum: 1 }, discount: { $sum: '$discountAmount' } } },
      { $sort: { redemptions: -1 } },
      { $limit: 20 },
      { $lookup: { from: Coupon.collection.name, localField: '_id', foreignField: '_id', as: 'coupon' } },
      { $unwind: { path: '$coupon', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          couponId: '$_id',
          code: '$coupon.code',
          discountType: '$coupon.discountType',
          redemptions: 1,
          discount: { $round: ['$discount', 2] },
        },
      },
    ]),
  ]);

  const t = totals[0] || { redemptions: 0, discount: 0, customers: 0 };

  return {
    range: describeRange(range),
    summary: {
      redemptions: t.redemptions,
      discountGiven: round2(t.discount),
      distinctCustomers: t.customers,
      averageDiscountPerRedemption: t.redemptions ? round2(t.discount / t.redemptions) : null,
    },
    breakdown: byCoupon,
  };
}

// ---------------------------------------------------------------------------
// OVERVIEW — the KPI header. Reuses the section functions above rather than
// re-deriving any figure, so the overview can never disagree with the detail
// page a click away.
// ---------------------------------------------------------------------------
async function getOverview(range) {
  const [sales, orders, customers, restaurantCounts, riders] = await Promise.all([
    salesTotals(range, null),
    Order.aggregate([{ $match: rangeFilter(range) }, { $group: { _id: '$orderStatus', count: { $sum: 1 } } }]),
    getCustomers(range),
    Promise.all([Restaurant.countDocuments({}), Restaurant.countDocuments({ isActive: true, isApproved: true })]),
    DeliveryPartner.countDocuments({ accountStatus: DELIVERY_ACCOUNT_STATUS.ACTIVE }),
  ]);

  const statusMap = new Map(orders.map((row) => [row._id, row.count]));
  const totalOrders = orders.reduce((sum, row) => sum + row.count, 0);
  const [totalRestaurants, activeRestaurants] = restaurantCounts;

  return {
    range: describeRange(range),
    summary: {
      totalOrders,
      fulfilledOrders: sales.orders,
      cancelledOrders: statusMap.get(ORDER_STATUS.CANCELLED) || 0,
      rejectedOrders: statusMap.get(ORDER_STATUS.REJECTED) || 0,
      refundedOrders: statusMap.get(ORDER_STATUS.REFUNDED) || 0,
      grossSales: sales.grossSales,
      discounts: sales.discounts,
      refunds: sales.refunds,
      netSales: sales.netSales,
      averageOrderValue: sales.averageOrderValue,
      totalRestaurants,
      activeRestaurants,
      activeDeliveryPartners: riders,
      totalCustomers: customers.summary.totalCustomers,
      newCustomers: customers.summary.newCustomers,
      activeCustomers: customers.summary.activeCustomers,
    },
  };
}

// ---------------------------------------------------------------------------
// OWNER-SCOPED analytics — one restaurant, resolved from the authenticated
// owner against the database (never a client-supplied id).
// ---------------------------------------------------------------------------
async function getRestaurantAnalytics(requester, restaurantId, range, { limit = 10 } = {}) {
  const restaurant = await resolveOwnerScope(requester, restaurantId);
  const scope = [restaurant._id];

  const [sales, orders, food, reviewRows] = await Promise.all([
    getSales(range, scope),
    getOrders(range, scope),
    getFood(range, scope, { limit }),
    Review.aggregate([
      { $match: { restaurant: restaurant._id, moderationStatus: REVIEW_MODERATION_STATUS.APPROVED, ...rangeFilter(range) } },
      { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$rating' } } },
    ]),
  ]);

  const reviews = reviewRows[0] || { count: 0, average: null };

  return {
    range: describeRange(range),
    restaurant: { id: restaurant._id, name: restaurant.name },
    summary: {
      ...sales.summary,
      totalOrders: orders.summary.totalOrders,
      fulfilledOrders: orders.summary.fulfilledOrders,
      cancelledOrders: orders.summary.cancelledOrders,
      rejectedOrders: orders.summary.rejectedOrders,
      completionRate: orders.summary.completionRate,
      cancellationRate: orders.summary.cancellationRate,
      // Lifetime figures straight off the restaurant document — the same
      // numbers its public page shows (APPROVED reviews only, per M15).
      lifetimeRating: restaurant.rating,
      lifetimeReviewCount: restaurant.totalReviews,
      // Reviews approved AND created inside the selected range.
      reviewsInRange: reviews.count,
      averageRatingInRange: reviews.average === null ? null : round2(reviews.average),
    },
    trend: sales.trend,
    byStatus: orders.byStatus,
    topItems: food.breakdown,
  };
}

// A compact, explicit echo of what was actually measured, so a client never has
// to guess which window (or timezone) produced the numbers it is rendering.
function describeRange(range) {
  return {
    preset: range.preset,
    start: range.start ? range.start.toISOString() : null,
    end: range.end ? range.end.toISOString() : null,
    timezone: 'UTC',
  };
}

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
  resolveOwnerScope,
  FULFILLED_SALE_MATCH,
  RESTAURANT_SORTS,
};
