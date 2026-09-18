const Order = require('../models/Order');
const Cart = require('../models/Cart');
const FoodItem = require('../models/FoodItem');
const Restaurant = require('../models/Restaurant');
const Address = require('../models/Address');
const ApiError = require('../utils/ApiError');
const paymentService = require('./payment.service');
const couponService = require('./coupon.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { ORDER_STATUS, ORDER_STATUS_TRANSITIONS, PAYMENT_METHODS, ROLES } = require('../utils/constants');

const TAX_RATE = 0.05; // kept in sync with cart.service.js's rate — same order math, computed fresh here

// Unlike the cart's browsing view (which silently drops changed/unavailable
// items so the customer can keep shopping), order placement fails loudly: if
// anything about the cart's contents changed since it was last viewed, the
// whole request is rejected so the customer can review before paying.
async function createOrder(user, { addressId, paymentMethod }) {
  const cart = await Cart.findOne({ user: user._id });
  if (!cart || cart.items.length === 0) throw ApiError.badRequest('Your cart is empty');
  if (!cart.restaurant) throw ApiError.badRequest('Your cart has no restaurant selected');

  const restaurant = await Restaurant.findById(cart.restaurant);
  if (!restaurant || !restaurant.isApproved || !restaurant.isActive) {
    throw ApiError.badRequest('This restaurant is no longer available');
  }
  if (!restaurant.isOpen) {
    throw ApiError.badRequest('This restaurant is currently closed and not accepting orders');
  }

  const address = await Address.findById(addressId);
  if (!address || address.user.toString() !== user._id.toString()) {
    throw ApiError.badRequest('Please select a valid delivery address');
  }

  const foods = await FoodItem.find({ _id: { $in: cart.items.map((i) => i.food) } });
  const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

  const orderItems = cart.items.map((item) => {
    const food = foodMap.get(item.food.toString());
    if (!food || !food.isAvailable) {
      throw ApiError.conflict(
        food ? `"${food.name}" is no longer available. Please update your cart.` : 'An item in your cart is no longer available. Please update your cart.'
      );
    }
    return { food: food._id, name: food.name, price: food.effectivePrice(), quantity: item.quantity, addons: item.addons };
  });

  const subtotal = orderItems.reduce((sum, item) => {
    const addonsTotal = item.addons.reduce((a, addon) => a + addon.price, 0);
    return sum + (item.price + addonsTotal) * item.quantity;
  }, 0);

  if (subtotal < restaurant.minimumOrder) {
    throw ApiError.badRequest(`This restaurant requires a minimum order of ₹${restaurant.minimumOrder}`);
  }

  let coupon = null;
  let discount = 0;
  if (cart.couponCode) {
    const result = await couponService.validateCoupon(cart.couponCode, subtotal).catch(() => null);
    if (result) {
      coupon = result.coupon;
      discount = result.discountAmount;
    }
  }

  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const totalAmount = Math.max(subtotal + restaurant.deliveryFee + tax - discount, 0);

  if (!Object.values(PAYMENT_METHODS).includes(paymentMethod)) {
    throw ApiError.badRequest('Invalid payment method');
  }
  const { paymentStatus, transactionId } = await paymentService.initiatePayment({
    method: paymentMethod,
    amount: totalAmount,
    orderRef: null,
  });

  const order = await Order.create({
    user: user._id,
    restaurant: restaurant._id,
    items: orderItems,
    deliveryAddress: {
      label: address.label,
      addressLine: address.addressLine,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      latitude: address.latitude,
      longitude: address.longitude,
    },
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    tax,
    discount,
    totalAmount,
    coupon: coupon ? { code: coupon.code, discountAmount: discount } : undefined,
    paymentMethod,
    paymentStatus,
    transactionId,
    orderStatus: ORDER_STATUS.PENDING,
    statusHistory: [{ status: ORDER_STATUS.PENDING, changedBy: user._id }],
    estimatedDeliveryTime: new Date(Date.now() + restaurant.deliveryTime * 60 * 1000),
  });

  if (coupon) await couponService.incrementUsage(coupon._id);

  cart.items = [];
  cart.restaurant = null;
  cart.couponCode = null;
  cart.subtotal = 0;
  cart.deliveryFee = 0;
  cart.tax = 0;
  cart.discount = 0;
  cart.total = 0;
  await cart.save();

  return order;
}

async function listOrdersForUser(user, query) {
  const { page, limit, skip } = parsePagination(query);
  let filter;

  if (user.role === ROLES.RESTAURANT_OWNER) {
    const restaurantIds = await Restaurant.find({ owner: user._id }).distinct('_id');
    if (query.restaurant) {
      if (!restaurantIds.map(String).includes(query.restaurant)) {
        throw ApiError.forbidden('You can only view orders for your own restaurant');
      }
      filter = { restaurant: query.restaurant };
    } else {
      filter = { restaurant: { $in: restaurantIds } };
    }
  } else if (user.role === ROLES.ADMIN) {
    filter = {};
  } else {
    filter = { user: user._id };
    // Lets a customer check "have I ordered from this restaurant" — used by
    // the review-eligibility check (Phase 11: only a delivered order unlocks
    // reviewing that restaurant).
    if (query.restaurant) filter.restaurant = query.restaurant;
  }
  if (query.status) filter.orderStatus = query.status;

  const [items, total] = await Promise.all([
    Order.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('restaurant', 'name image'),
    Order.countDocuments(filter),
  ]);

  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getOrderById(user, orderId) {
  const order = await Order.findById(orderId).populate('restaurant', 'name image owner');
  if (!order) throw ApiError.notFound('Order not found');

  const isCustomer = order.user.toString() === user._id.toString();
  const isOwner = user.role === ROLES.RESTAURANT_OWNER && order.restaurant.owner.toString() === user._id.toString();
  const isAdmin = user.role === ROLES.ADMIN;
  if (!isCustomer && !isOwner && !isAdmin) throw ApiError.notFound('Order not found');

  return order;
}

async function updateOrderStatus(user, orderId, nextStatus) {
  const order = await Order.findById(orderId).populate('restaurant', 'owner');
  if (!order) throw ApiError.notFound('Order not found');

  const isOwner = user.role === ROLES.RESTAURANT_OWNER && order.restaurant.owner.toString() === user._id.toString();
  const isAdmin = user.role === ROLES.ADMIN;
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Only the restaurant or an admin can update order status');

  const allowed = ORDER_STATUS_TRANSITIONS[order.orderStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(`Cannot move an order from "${order.orderStatus}" to "${nextStatus}"`);
  }

  order.orderStatus = nextStatus;
  order.statusHistory.push({ status: nextStatus, changedBy: user._id });
  await order.save();
  return order;
}

async function cancelOrder(user, orderId, reason) {
  const order = await Order.findById(orderId).populate('restaurant', 'owner');
  if (!order) throw ApiError.notFound('Order not found');

  const isCustomer = order.user.toString() === user._id.toString();
  const isOwner = user.role === ROLES.RESTAURANT_OWNER && order.restaurant.owner.toString() === user._id.toString();
  const isAdmin = user.role === ROLES.ADMIN;
  if (!isCustomer && !isOwner && !isAdmin) throw ApiError.forbidden('You cannot cancel this order');

  const allowed = ORDER_STATUS_TRANSITIONS[order.orderStatus] || [];
  if (!allowed.includes(ORDER_STATUS.CANCELLED)) {
    throw ApiError.badRequest(`This order can no longer be cancelled (current status: "${order.orderStatus}")`);
  }
  // A customer can back out only before the kitchen starts cooking. Once
  // "preparing", the transition map still technically allows cancellation (the
  // restaurant might run out of an ingredient), but that's the restaurant/admin's
  // call to make from here, not the customer's.
  if (isCustomer && !isOwner && !isAdmin && order.orderStatus === ORDER_STATUS.PREPARING) {
    throw ApiError.forbidden('This order is already being prepared. Please contact the restaurant to cancel.');
  }

  order.orderStatus = ORDER_STATUS.CANCELLED;
  order.cancellationReason = reason || null;
  order.statusHistory.push({ status: ORDER_STATUS.CANCELLED, changedBy: user._id });
  await order.save();
  return order;
}

module.exports = { createOrder, listOrdersForUser, getOrderById, updateOrderStatus, cancelOrder };
