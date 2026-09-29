const Order = require('../models/Order');
const Cart = require('../models/Cart');
const FoodItem = require('../models/FoodItem');
const Restaurant = require('../models/Restaurant');
const Address = require('../models/Address');
const Payment = require('../models/Payment');
const DeliveryPartner = require('../models/DeliveryPartner');
const ApiError = require('../utils/ApiError');
const paymentService = require('./payment.service');
const couponService = require('./coupon.service');
const refundService = require('./refund.service');
const deliveryAssignmentService = require('./deliveryAssignment.service');
const deliveryOtpService = require('./deliveryOtp.service');
const restaurantGeoService = require('./restaurantGeo.service');
const notificationService = require('./notification.service');
const { isOpenNow } = require('../utils/openingHours');
const { nextOrderNumber } = require('../utils/orderNumber');
const pricing = require('./pricing.service');
const platformSettingService = require('./platformSetting.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const {
  ORDER_STATUS, ORDER_STATUS_TRANSITIONS, PAYMENT_METHODS, PAYMENT_STATUS, PAYMENT_ATTEMPT_STATUS, ROLES, NOTIFICATION_TYPE,
} = require('../utils/constants');
const { PERMISSIONS, hasPermission } = require('../utils/permissions');

function razorpayPublicConfig(razorpayOrderId, amount) {
  return { orderId: razorpayOrderId, amount, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID };
}

// A cancellation/rejection of a paid online order should refund it automatically.
// Never lets a refund failure undo or block the status change that triggered it —
// refund.service.js already logs and records the failure for an admin to retry.
async function autoRefundIfPaid(order, actor, reason) {
  if (order.paymentMethod !== PAYMENT_METHODS.ONLINE || order.paymentStatus !== PAYMENT_STATUS.PAID) return;
  try {
    await refundService.initiateRefund(order, { reason, actor });
  } catch (err) {
    console.error(`Auto-refund failed for order ${order.orderNumber}:`, err.message);
  }
}

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
  if (!isOpenNow(restaurant)) {
    throw ApiError.badRequest('This restaurant is currently closed and not accepting orders');
  }

  const address = await Address.findById(addressId);
  if (!address || address.user.toString() !== user._id.toString()) {
    throw ApiError.badRequest('Please select a valid delivery address');
  }

  // Refuse an address that is measurably outside the restaurant's delivery radius.
  const deliveryDistanceKm = restaurantGeoService.assertDeliverable(restaurant, address);

  const foods = await FoodItem.find({ _id: { $in: cart.items.map((i) => i.food) } });
  const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

  const orderItems = cart.items.map((item) => {
    const food = foodMap.get(item.food.toString());
    if (!food || !food.isAvailable) {
      throw ApiError.conflict(
        food ? `"${food.name}" is no longer available. Please update your cart.` : 'An item in your cart is no longer available. Please update your cart.'
      );
    }
    const hasVariants = food.variants && food.variants.length > 0;
    if (Boolean(item.variantId) !== hasVariants) {
      throw ApiError.conflict(`"${food.name}" has changed since you added it. Please update your cart.`);
    }
    const price = pricing.unitPriceFor(food, item.variantId);
    if (price == null) {
      throw ApiError.conflict(`The selected option for "${food.name}" is no longer available. Please update your cart.`);
    }
    const variant = item.variantId ? food.variants.id(item.variantId) : null;
    return {
      food: food._id, name: food.name, price, quantity: item.quantity, addons: item.addons,
      variantName: variant ? variant.name : null, note: item.note || '',
    };
  });

  const subtotal = pricing.subtotalOf(orderItems);

  if (subtotal < restaurant.minimumOrder) {
    throw ApiError.badRequest(`This restaurant requires a minimum order of ₹${restaurant.minimumOrder}`);
  }

  // Fail loudly, like every other check here: if the coupon the customer saw in
  // their cart no longer applies, silently charging the undiscounted price would
  // be a nasty surprise — so the order is rejected and they can review the cart.
  let coupon = null;
  let discount = 0;
  if (cart.couponCode) {
    try {
      const context = { restaurantId: restaurant._id, city: restaurant.city, userId: user._id };
      const result = await couponService.validateCoupon(cart.couponCode, subtotal, context);
      coupon = result.coupon;
      discount = result.discountAmount;
    } catch (err) {
      throw ApiError.conflict(`Coupon "${cart.couponCode}" can no longer be applied (${err.message}). Please review your cart.`);
    }
  }

  // M17 — the configurable tax rate, read once here. The resulting tax and
  // totalAmount are then frozen onto the order, so a later rate change never
  // alters what this customer was charged.
  const taxRate = await platformSettingService.getTaxRate();
  const { tax, total: totalAmount } = pricing.computeTotals({ subtotal, deliveryFee: restaurant.deliveryFee, discount, taxRate });

  if (!Object.values(PAYMENT_METHODS).includes(paymentMethod)) {
    throw ApiError.badRequest('Invalid payment method');
  }
  const { paymentStatus, transactionId } = await paymentService.initiatePayment({ method: paymentMethod });

  const orderNumber = await nextOrderNumber();

  // For ONLINE, the Razorpay order is created BEFORE our own order — a network call
  // that can fail, and failing here means nothing has been written yet (no order, no
  // claimed coupon), so there is nothing to roll back.
  let razorpayOrderId = null;
  if (paymentMethod === PAYMENT_METHODS.ONLINE) {
    const razorpayOrder = await paymentService.createRazorpayOrder(totalAmount, orderNumber);
    razorpayOrderId = razorpayOrder.razorpayOrderId;
  }

  const orderData = {
    orderNumber,
    user: user._id,
    restaurant: restaurant._id,
    items: orderItems,
    deliveryAddress: {
      label: address.label,
      name: address.name,
      phone: address.phone,
      addressLine: address.addressLine,
      addressLine2: address.addressLine2,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      latitude: address.latitude,
      longitude: address.longitude,
    },
    deliveryDistanceKm,
    subtotal,
    deliveryFee: restaurant.deliveryFee,
    tax,
    discount,
    totalAmount,
    coupon: coupon ? { code: coupon.code, discountAmount: discount } : undefined,
    paymentMethod,
    paymentStatus,
    transactionId,
    razorpayOrderId,
    orderStatus: ORDER_STATUS.PLACED,
    statusHistory: [{ status: ORDER_STATUS.PLACED, changedBy: user._id }],
    estimatedDeliveryTime: new Date(Date.now() + restaurant.deliveryTime * 60 * 1000),
  };

  // Claim the coupon use atomically right before the order is written, and hand it
  // back if the write fails, so the usage limit holds under concurrent checkouts
  // and a failed checkout doesn't burn the customer's coupon.
  if (coupon && !(await couponService.redeemCoupon(coupon._id))) {
    throw ApiError.conflict(`Coupon "${coupon.code}" has just reached its usage limit. Please review your cart.`);
  }

  let order;
  try {
    order = await Order.create(orderData);
  } catch (err) {
    if (coupon) await couponService.releaseCoupon(coupon._id);
    throw err;
  }

  if (coupon) await couponService.recordUsage({ couponId: coupon._id, userId: user._id, orderId: order._id, discountAmount: discount });

  let razorpay = null;
  if (paymentMethod === PAYMENT_METHODS.ONLINE) {
    const payment = await Payment.create({ order: order._id, user: user._id, razorpayOrderId, amount: totalAmount });
    order.latestPayment = payment._id;
    await order.save();
    razorpay = razorpayPublicConfig(razorpayOrderId, totalAmount);
  }

  cart.items = [];
  cart.restaurant = null;
  cart.couponCode = null;
  cart.subtotal = 0;
  cart.deliveryFee = 0;
  cart.tax = 0;
  cart.discount = 0;
  cart.total = 0;
  await cart.save();

  // Awaited for determinism (a caller checking for the notification right after
  // this resolves should find it) — notify() itself never throws, so this can
  // never turn into an order-creation failure (Part 13).
  const orderNotifyData = { orderId: order._id, orderNumber: order.orderNumber, totalAmount };
  await notificationService.notify({
    recipient: user,
    type: NOTIFICATION_TYPE.ORDER_PLACED,
    data: orderNotifyData,
    eventKey: `ORDER:${order._id}:PLACED:${user._id}`,
  });
  await notificationService.notify({
    recipient: restaurant.owner,
    type: NOTIFICATION_TYPE.ORDER_PLACED,
    data: orderNotifyData,
    eventKey: `ORDER:${order._id}:PLACED:${restaurant.owner}`,
  });

  return { order, razorpay };
}

// For an ONLINE order whose payment is still unpaid (the customer closed Checkout.js,
// their bank declined, etc.) — creates a fresh Razorpay order for the SAME FoodRush
// order, without re-touching the cart, coupon or item pricing. Each attempt is its
// own Payment row (see models/Payment.js).
async function retryPayment(user, orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user.toString() !== user._id.toString()) throw ApiError.forbidden('You cannot retry payment for this order');
  if (order.paymentMethod !== PAYMENT_METHODS.ONLINE) throw ApiError.badRequest('This order is not an online payment');
  if (order.paymentStatus === PAYMENT_STATUS.PAID) throw ApiError.badRequest('This order has already been paid');
  if (![ORDER_STATUS.PLACED, ORDER_STATUS.CONFIRMED].includes(order.orderStatus)) {
    throw ApiError.badRequest(`This order can no longer be paid for (current status: "${order.orderStatus}")`);
  }

  const razorpayOrder = await paymentService.createRazorpayOrder(order.totalAmount, `${order.orderNumber}-${Date.now()}`);
  const payment = await Payment.create({ order: order._id, user: user._id, razorpayOrderId: razorpayOrder.razorpayOrderId, amount: order.totalAmount });

  order.razorpayOrderId = razorpayOrder.razorpayOrderId;
  order.latestPayment = payment._id;
  order.paymentStatus = PAYMENT_STATUS.PENDING;
  await order.save();

  return { order, razorpay: razorpayPublicConfig(razorpayOrder.razorpayOrderId, order.totalAmount) };
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
  } else if (hasPermission(user, PERMISSIONS.ORDERS_READ_ALL)) {
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

// The single rule for "may this user see this order" — shared by getOrderById,
// the tracking-snapshot endpoint below, and the Socket.IO room-join authorization
// (realtime/socketHandlers.js), so all three transports agree exactly. Never
// leaks existence to someone who fails every check (callers throw notFound, not
// forbidden, on a false return — same reasoning as the rest of this file).
async function canAccessOrder(user, order) {
  const isCustomer = order.user.toString() === user._id.toString();
  const isOwner = user.role === ROLES.RESTAURANT_OWNER && order.restaurant.owner.toString() === user._id.toString();
  const isAdmin = hasPermission(user, PERMISSIONS.ORDERS_READ_ALL);
  if (isCustomer || isOwner || isAdmin) return true;

  if (user.role === ROLES.DELIVERY_PARTNER && order.deliveryPartner) {
    const rider = await DeliveryPartner.findOne({ user: user._id }).select('_id');
    if (!rider) return false;
    const orderRiderId = order.deliveryPartner._id || order.deliveryPartner;
    return rider._id.toString() === orderRiderId.toString();
  }
  return false;
}

async function getOrderById(user, orderId) {
  const order = await Order.findById(orderId)
    .populate('restaurant', 'name image owner')
    .populate('deliveryPartner', deliveryAssignmentService.PUBLIC_RIDER_FIELDS);
  if (!order) throw ApiError.notFound('Order not found');
  if (!(await canAccessOrder(user, order))) throw ApiError.notFound('Order not found');

  return order;
}

// A lightweight snapshot for the tracking page's initial load / reconnect
// recovery (live updates afterwards arrive over Socket.IO) — the same
// authorization as getOrderById, but returns only what the map/UI needs, never
// the rider's KYC fields. `tracking: false` covers every reason there is
// currently nothing to show (no rider assigned yet, order not OUT_FOR_DELIVERY,
// or the rider hasn't sent a location yet) without distinguishing which, so the
// frontend has one simple branch plus a friendly message it already owns.
async function getOrderTrackingSnapshot(user, orderId) {
  const order = await Order.findById(orderId)
    .populate('restaurant', 'owner')
    .populate('deliveryPartner', 'fullName vehicleType vehicleNumber phone currentLocation locationAccuracyMeters lastLocationAt');
  if (!order) throw ApiError.notFound('Order not found');
  if (!(await canAccessOrder(user, order))) throw ApiError.notFound('Order not found');

  const rider = order.deliveryPartner;
  if (!rider || order.orderStatus !== ORDER_STATUS.OUT_FOR_DELIVERY) {
    return { tracking: false, orderStatus: order.orderStatus };
  }

  const coordinates = rider.currentLocation?.coordinates;
  return {
    tracking: true,
    orderStatus: order.orderStatus,
    rider: { fullName: rider.fullName, vehicleType: rider.vehicleType, vehicleNumber: rider.vehicleNumber, phone: rider.phone },
    location: coordinates
      ? { latitude: coordinates[1], longitude: coordinates[0], accuracy: rider.locationAccuracyMeters, updatedAt: rider.lastLocationAt }
      : null,
  };
}

// GET /orders/:id/delivery-otp — deliberately NARROWER than canAccessOrder: only
// the customer who placed the order, full stop. The restaurant owner, the
// assigned rider, and admins all use canAccessOrder elsewhere in this file, but
// none of them may ever see the plaintext OTP — that is the entire point of this
// milestone, so this check does not delegate to the shared helper at all. A
// wrong owner (or a non-existent order) gets an identical 404, never confirming
// whether the order exists or has an OTP.
async function getDeliveryOtp(user, orderId) {
  const order = await Order.findById(orderId).select(
    '+deliveryOtpCipher +deliveryOtpExpiresAt +deliveryOtpAttempts +deliveryOtpVerifiedAt user orderStatus'
  );
  if (!order || order.user.toString() !== user._id.toString()) throw ApiError.notFound('Order not found');

  const now = new Date();
  const notEligible =
    order.orderStatus !== ORDER_STATUS.OUT_FOR_DELIVERY ||
    !order.deliveryOtpCipher ||
    order.deliveryOtpVerifiedAt || // already used — never re-served, even if the state above were somehow still OUT_FOR_DELIVERY
    order.deliveryOtpExpiresAt <= now;
  if (notEligible) {
    return { available: false, orderStatus: order.orderStatus };
  }
  if (order.deliveryOtpAttempts >= deliveryOtpService.MAX_ATTEMPTS) {
    return { available: false, orderStatus: order.orderStatus, locked: true };
  }

  const otp = deliveryOtpService.decryptOtp(order.deliveryOtpCipher);
  if (!otp) return { available: false, orderStatus: order.orderStatus }; // corrupt/tampered ciphertext — never surfaced as a crash

  return {
    available: true,
    otp,
    expiresAt: order.deliveryOtpExpiresAt,
    attemptsRemaining: deliveryOtpService.MAX_ATTEMPTS - order.deliveryOtpAttempts,
  };
}

async function updateOrderStatus(user, orderId, nextStatus) {
  const order = await Order.findById(orderId).populate('restaurant', 'owner');
  if (!order) throw ApiError.notFound('Order not found');

  const isOwner = user.role === ROLES.RESTAURANT_OWNER && order.restaurant.owner.toString() === user._id.toString();
  const isAdmin = hasPermission(user, PERMISSIONS.ORDERS_MANAGE);
  if (!isOwner && !isAdmin) throw ApiError.forbidden('Only the restaurant or an admin can update order status');

  const allowed = ORDER_STATUS_TRANSITIONS[order.orderStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(`Cannot move an order from "${order.orderStatus}" to "${nextStatus}"`);
  }

  order.orderStatus = nextStatus;
  order.statusHistory.push({ status: nextStatus, changedBy: user._id });
  await order.save();

  const notifyData = { orderId: order._id, orderNumber: order.orderNumber };
  if (nextStatus === ORDER_STATUS.CONFIRMED) {
    await notificationService.notify({
      recipient: order.user,
      type: NOTIFICATION_TYPE.ORDER_CONFIRMED,
      data: notifyData,
      eventKey: `ORDER:${order._id}:CONFIRMED:${order.user}`,
    });
  }

  if (nextStatus === ORDER_STATUS.REJECTED) {
    await notificationService.notify({
      recipient: order.user,
      type: NOTIFICATION_TYPE.ORDER_REJECTED,
      data: notifyData,
      eventKey: `ORDER:${order._id}:REJECTED:${order.user}`,
    });
    await autoRefundIfPaid(order, user, 'restaurant_rejection');
    await deliveryAssignmentService.onOrderStatusChanged(order, user);
  }

  if (nextStatus === ORDER_STATUS.READY_FOR_PICKUP) {
    await notificationService.notify({
      recipient: order.user,
      type: NOTIFICATION_TYPE.ORDER_READY,
      data: notifyData,
      eventKey: `ORDER:${order._id}:READY:${order.user}`,
    });
  }

  // The restaurant marking food ready is the dispatch trigger (M7) — find an
  // eligible nearby ONLINE rider and offer them the delivery. Best-effort: no
  // rider being available right now must never block the restaurant's own status
  // change; the order simply stays READY_FOR_PICKUP (manually deliverable, or
  // retryable by an admin) until someone accepts.
  if (nextStatus === ORDER_STATUS.READY_FOR_PICKUP) {
    await deliveryAssignmentService.dispatchOrder(order).catch((err) => {
      console.error(`Dispatch failed for order ${order.orderNumber}:`, err.message);
    });
  }
  // Any order that reaches DELIVERED closes out its assignment as COMPLETED; this
  // also covers the restaurant's own manual OUT_FOR_DELIVERY->DELIVERED path when
  // no rider was ever assigned (a no-op in that case).
  if (nextStatus === ORDER_STATUS.DELIVERED) {
    await deliveryAssignmentService.onOrderStatusChanged(order, user);
  }

  return order;
}

async function cancelOrder(user, orderId, reason) {
  const order = await Order.findById(orderId).populate('restaurant', 'owner');
  if (!order) throw ApiError.notFound('Order not found');

  const isCustomer = order.user.toString() === user._id.toString();
  const isOwner = user.role === ROLES.RESTAURANT_OWNER && order.restaurant.owner.toString() === user._id.toString();
  const isAdmin = hasPermission(user, PERMISSIONS.ORDERS_MANAGE);
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

  // Notify whichever side did NOT perform the cancellation — the actor already
  // knows, since they just did it.
  const cancelledByCustomer = isCustomer && !isOwner && !isAdmin;
  const notifyRecipient = cancelledByCustomer ? order.restaurant.owner : order.user;
  await notificationService.notify({
    recipient: notifyRecipient,
    type: NOTIFICATION_TYPE.ORDER_CANCELLED,
    data: { orderId: order._id, orderNumber: order.orderNumber, reason: order.cancellationReason },
    eventKey: `ORDER:${order._id}:CANCELLED:${notifyRecipient}`,
  });

  const refundReason = cancelledByCustomer ? 'customer_cancellation' : 'restaurant_unavailable';
  await autoRefundIfPaid(order, user, refundReason);
  await deliveryAssignmentService.onOrderStatusChanged(order, user);

  return order;
}

// Called by the frontend once Razorpay's Checkout.js hands back a payment
// confirmation, to prove that confirmation actually came from Razorpay rather than
// being forged client-side. Verified against THIS order's current razorpayOrderId —
// a valid signature from a genuinely different (the caller's own) payment must not
// be replayable onto an unrelated order.
async function verifyOnlinePayment(user, orderId, { razorpayOrderId, razorpayPaymentId, signature }) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user.toString() !== user._id.toString()) throw ApiError.forbidden('You cannot verify payment for this order');
  if (order.paymentMethod !== PAYMENT_METHODS.ONLINE) throw ApiError.badRequest('This order is not an online payment');

  if (order.paymentStatus === PAYMENT_STATUS.PAID) return order; // idempotent — already verified

  if (order.razorpayOrderId !== razorpayOrderId) {
    throw ApiError.badRequest('This payment does not match the current payment attempt for this order');
  }

  const isValid = paymentService.verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature });
  const payment = await Payment.findOne({ order: order._id, razorpayOrderId });

  if (!isValid) {
    order.paymentStatus = PAYMENT_STATUS.FAILED;
    await order.save();
    if (payment) {
      payment.status = PAYMENT_ATTEMPT_STATUS.FAILED;
      payment.failureReason = 'Signature verification failed';
      await payment.save();
    }
    // The customer is right here on the checkout page — a retry really is the
    // immediate next action, unlike an out-of-band webhook failure (see
    // payment.controller.js's handlePaymentFailed, which uses PAYMENT_FAILED
    // instead). Fired before the throw below: the state change already
    // happened and is real, independent of what this call then reports back
    // to the caller's own browser.
    await notificationService.notify({
      recipient: order.user,
      type: NOTIFICATION_TYPE.PAYMENT_RETRY_REQUIRED,
      data: { orderId: order._id, orderNumber: order.orderNumber },
      eventKey: `PAYMENT:${razorpayOrderId}:RETRY_REQUIRED:${order.user}`,
    });
    throw ApiError.badRequest('Payment verification failed');
  }

  order.paymentStatus = PAYMENT_STATUS.PAID;
  order.transactionId = razorpayPaymentId;
  await order.save();
  if (payment) {
    payment.status = PAYMENT_ATTEMPT_STATUS.PAID;
    payment.razorpayPaymentId = razorpayPaymentId;
    payment.confirmedVia = 'verify_endpoint';
    await payment.save();
  }

  // Scoped to the razorpayPaymentId (not the order) so this converges with the
  // webhook's own handlePaymentCaptured notification for the SAME payment
  // (Part 12) — whichever of the two reaches Mongo first wins; the other's
  // duplicate eventKey is a harmless no-op, never a second email/notification.
  await notificationService.notify({
    recipient: order.user,
    type: NOTIFICATION_TYPE.PAYMENT_SUCCESS,
    data: { orderId: order._id, orderNumber: order.orderNumber, amount: order.totalAmount },
    eventKey: `PAYMENT:${razorpayPaymentId}:SUCCESS:${order.user}`,
  });

  return order;
}

module.exports = {
  createOrder,
  retryPayment,
  listOrdersForUser,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
  verifyOnlinePayment,
  canAccessOrder,
  getOrderTrackingSnapshot,
  getDeliveryOtp,
};
