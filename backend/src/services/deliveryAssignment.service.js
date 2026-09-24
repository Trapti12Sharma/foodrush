const mongoose = require('mongoose');
const DeliveryAssignment = require('../models/DeliveryAssignment');
const DeliveryPartner = require('../models/DeliveryPartner');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { emitTrackingEnded } = require('../realtime/io');
const deliveryOtpService = require('./deliveryOtp.service');
const deliveryEarningService = require('./deliveryEarning.service');
const notificationService = require('./notification.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { isValidPointCoordinates, haversineKm, roundTo, DEFAULT_RIDER_SEARCH_RADIUS_KM } = require('../utils/geo');
const {
  ORDER_STATUS,
  DELIVERY_ASSIGNMENT_STATUS,
  ACTIVE_ASSIGNMENT_STATUSES,
  DELIVERY_ACCOUNT_STATUS,
  DELIVERY_KYC_STATUS,
  DELIVERY_AVAILABILITY,
  NOTIFICATION_TYPE,
} = require('../utils/constants');

// How long a rider has to respond to an offer. Deliberately generous for a
// foundation milestone with no push notifications yet — a rider has to notice the
// offer by polling their dashboard.
const OFFER_TTL_MS = 90 * 1000;

// Fields safe to show to someone who is NOT the rider themself or an admin (a
// customer/restaurant owner looking at an order, or another candidate rider) —
// never KYC documents, licence numbers, DOB, address, or emergency contact.
const PUBLIC_RIDER_FIELDS = 'fullName phone vehicleType vehicleNumber';

// A rider is busy — never offered a new order — while they hold an unexpired
// pending offer OR are actively delivering something else. Two separate reasons,
// checked together: "already has a decision to make" and "already on a job".
async function busyRiderIds() {
  const [onDelivery, pendingOffer] = await Promise.all([
    DeliveryAssignment.find({ status: { $in: [DELIVERY_ASSIGNMENT_STATUS.ACCEPTED, DELIVERY_ASSIGNMENT_STATUS.ASSIGNED] } }).distinct('deliveryPartner'),
    DeliveryAssignment.find({ status: DELIVERY_ASSIGNMENT_STATUS.OFFERED, expiresAt: { $gt: new Date() } }).distinct('deliveryPartner'),
  ]);
  return [...onDelivery, ...pendingOffer];
}

// Real geography only — $geoNear against the 2dsphere-indexed currentLocation,
// exactly the pattern restaurantGeo.service.js uses for restaurants. A rider with
// no currentLocation at all is never returned (that's what "valid location exists"
// means here) — $geoNear excludes documents missing the indexed field entirely.
async function findEligibleRiders(restaurant, { excludeIds = [], limit = 20 } = {}) {
  const coordinates = restaurant.location?.coordinates;
  if (!isValidPointCoordinates(coordinates)) return [];

  const excluded = [...new Set(excludeIds.map(String))].map((id) => new mongoose.Types.ObjectId(id));

  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates },
        distanceField: 'distanceMeters',
        maxDistance: DEFAULT_RIDER_SEARCH_RADIUS_KM * 1000,
        spherical: true,
        query: {
          accountStatus: DELIVERY_ACCOUNT_STATUS.ACTIVE,
          kycStatus: DELIVERY_KYC_STATUS.VERIFIED,
          availability: DELIVERY_AVAILABILITY.ONLINE,
          ...(excluded.length ? { _id: { $nin: excluded } } : {}),
        },
      },
    },
    { $sort: { distanceMeters: 1 } },
    { $limit: limit },
    { $project: { fullName: 1, phone: 1, vehicleType: 1, vehicleNumber: 1, distanceMeters: 1 } },
  ];

  const riders = await DeliveryPartner.aggregate(pipeline);
  return riders.map((r) => ({ ...r, distanceKm: roundTo(r.distanceMeters / 1000, 1) }));
}

// Any OFFERED row for this order whose deadline has passed is flipped to EXPIRED
// right here — lazily, on demand, never by a background timer. This both keeps
// admin/rider views honest and clears the partial-unique-index slot so a new offer
// can be created for the order.
async function expireStaleOffers(orderId) {
  await DeliveryAssignment.updateMany(
    { order: orderId, status: DELIVERY_ASSIGNMENT_STATUS.OFFERED, expiresAt: { $lte: new Date() } },
    { $set: { status: DELIVERY_ASSIGNMENT_STATUS.EXPIRED } }
  );
}

// Creates a fresh OFFERED assignment for the best (nearest) eligible rider who
// hasn't already been offered this exact order before. Returns null (not an
// error) when the order isn't dispatch-eligible or nobody is available right now
// — dispatch failing must never block whatever triggered it (the restaurant
// marking food ready, a rejection, an admin retry).
async function dispatchOrder(order) {
  if (order.orderStatus !== ORDER_STATUS.READY_FOR_PICKUP || order.deliveryPartner) return null;

  await expireStaleOffers(order._id);

  const restaurant = await Restaurant.findById(order.restaurant);
  if (!restaurant) return null;

  // Never re-offer to a rider who has already seen this order before (rejected,
  // expired, or had their offer cancelled) — automatic dispatch always moves
  // forward. An admin's manual assignment can still explicitly pick anyone.
  const alreadyOfferedIds = await DeliveryAssignment.find({ order: order._id }).distinct('deliveryPartner');
  const excludeIds = [...alreadyOfferedIds, ...(await busyRiderIds())];

  const candidates = await findEligibleRiders(restaurant, { excludeIds, limit: 1 });
  if (candidates.length === 0) return null;

  return createOffer(order._id, candidates[0]._id, candidates[0].distanceKm);
}

async function createOffer(orderId, deliveryPartnerId, distanceKm = null) {
  let assignment;
  try {
    assignment = await DeliveryAssignment.create({
      order: orderId,
      deliveryPartner: deliveryPartnerId,
      status: DELIVERY_ASSIGNMENT_STATUS.OFFERED,
      offeredAt: new Date(),
      expiresAt: new Date(Date.now() + OFFER_TTL_MS),
      distanceKmAtOffer: distanceKm,
    });
  } catch (err) {
    // The partial unique index — another offer is already active for this order.
    if (err.code === 11000) throw ApiError.conflict('This order already has an active delivery assignment');
    throw err;
  }

  // The single choke point both automatic dispatch and admin manual assignment
  // flow through — one notification call covers both. Best-effort: a rider who
  // never sees this offer just lets it expire, exactly like today.
  const [rider, order] = await Promise.all([
    DeliveryPartner.findById(deliveryPartnerId).select('user'),
    Order.findById(orderId).select('orderNumber'),
  ]);
  if (rider && order) {
    await notificationService.notify({
      recipient: rider.user,
      type: NOTIFICATION_TYPE.DELIVERY_ASSIGNED,
      data: { orderId, orderNumber: order.orderNumber, assignmentId: assignment._id },
      eventKey: `DELIVERY:${assignment._id}:ASSIGNED:${rider.user}`,
    });
  }

  return assignment;
}

// Admin-triggered: either offer to a SPECIFIC rider (manual dispatch), or, with no
// riderId, run the same automatic nearest-eligible-candidate logic as dispatchOrder
// — useful to retry after an offer expired with nobody left to auto-advance to.
async function adminAssign(orderId, riderId, actor) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.orderStatus !== ORDER_STATUS.READY_FOR_PICKUP) {
    throw ApiError.badRequest(`Only an order that is READY_FOR_PICKUP can be assigned a rider (current status: "${order.orderStatus}")`);
  }
  if (order.deliveryPartner) throw ApiError.badRequest('This order already has an assigned delivery partner');

  await expireStaleOffers(order._id);

  if (!riderId) {
    const assignment = await dispatchOrder(order);
    if (!assignment) throw ApiError.badRequest('No eligible delivery partner is currently available for this order');
    return assignment;
  }

  const rider = await DeliveryPartner.findById(riderId);
  if (!rider) throw ApiError.notFound('Delivery partner not found');
  if (rider.accountStatus !== DELIVERY_ACCOUNT_STATUS.ACTIVE) throw ApiError.badRequest('This delivery partner is not active');
  if (rider.kycStatus !== DELIVERY_KYC_STATUS.VERIFIED) throw ApiError.badRequest('This delivery partner is not KYC-verified');
  if (rider.availability !== DELIVERY_AVAILABILITY.ONLINE) throw ApiError.badRequest('This delivery partner is not online');
  if ((await busyRiderIds()).some((id) => id.toString() === riderId.toString())) {
    throw ApiError.badRequest('This delivery partner is already busy with another delivery or pending offer');
  }

  const restaurant = await Restaurant.findById(order.restaurant);
  const coordinates = restaurant?.location?.coordinates;
  const riderCoordinates = rider.currentLocation?.coordinates;
  const distanceKm =
    isValidPointCoordinates(coordinates) && isValidPointCoordinates(riderCoordinates)
      ? roundTo(haversineKm(coordinates[1], coordinates[0], riderCoordinates[1], riderCoordinates[0]), 1)
      : null;

  return createOffer(order._id, rider._id, distanceKm);
}

// Rider accepts an OFFERED assignment. Two separate atomic steps, exactly matching
// the ACCEPTED vs ASSIGNED distinction in constants.js:
//   1) claim the ASSIGNMENT row itself (guards: still OFFERED, still unexpired,
//      belongs to this rider) — this is what protects against two concurrent
//      accept requests for the SAME offer (impossible anyway since only one rider
//      is ever offered at a time, but defended regardless).
//   2) claim the ORDER (guards: still has no deliveryPartner, still
//      READY_FOR_PICKUP) — this is what protects against a genuinely concurrent
//      double-assignment (e.g. an admin manually assigning a second rider at the
//      same instant). If step 2 loses, the assignment is CANCELLED rather than
//      left stuck ACCEPTED, and the rider is told the order was already taken.
async function acceptAssignment(rider, assignmentId) {
  if (rider.accountStatus !== DELIVERY_ACCOUNT_STATUS.ACTIVE) throw ApiError.badRequest('Your account is not active');
  if (rider.kycStatus !== DELIVERY_KYC_STATUS.VERIFIED) throw ApiError.badRequest('Your KYC is not verified');
  if (rider.availability !== DELIVERY_AVAILABILITY.ONLINE) throw ApiError.badRequest('You must be online to accept a delivery');

  const now = new Date();
  const claimed = await DeliveryAssignment.findOneAndUpdate(
    { _id: assignmentId, deliveryPartner: rider._id, status: DELIVERY_ASSIGNMENT_STATUS.OFFERED, expiresAt: { $gt: now } },
    { $set: { status: DELIVERY_ASSIGNMENT_STATUS.ACCEPTED, acceptedAt: now, respondedAt: now } },
    { new: true }
  );

  if (!claimed) {
    // Distinguish "expired" from "not yours / already responded" for a clearer
    // error, self-healing the row to EXPIRED if that's genuinely what happened.
    const existing = await DeliveryAssignment.findById(assignmentId);
    if (existing && existing.deliveryPartner.toString() === rider._id.toString() && existing.status === DELIVERY_ASSIGNMENT_STATUS.OFFERED) {
      await DeliveryAssignment.updateOne({ _id: assignmentId }, { $set: { status: DELIVERY_ASSIGNMENT_STATUS.EXPIRED } });
      throw ApiError.badRequest('This offer has expired');
    }
    throw ApiError.badRequest('This offer is no longer available to respond to');
  }

  // The delivery-completion OTP (M9) is generated right here — the moment a rider
  // is actually assigned — never earlier. It rides along in the SAME atomic
  // update that claims the order, so there is no window where the order is
  // OUT_FOR_DELIVERY without an OTP already in place.
  const { fields: otpFields } = deliveryOtpService.freshOtpFields();

  const order = await Order.findOneAndUpdate(
    { _id: claimed.order, deliveryPartner: null, orderStatus: ORDER_STATUS.READY_FOR_PICKUP },
    {
      $set: { deliveryPartner: rider._id, orderStatus: ORDER_STATUS.OUT_FOR_DELIVERY, ...otpFields },
      $push: { statusHistory: { status: ORDER_STATUS.OUT_FOR_DELIVERY, changedBy: rider.user } },
    },
    { new: true }
  );

  if (!order) {
    // Lost the race for the order itself — extremely rare (see comment above) but
    // handled: the assignment must not sit ACCEPTED forever pointing at an order
    // it never actually got.
    claimed.status = DELIVERY_ASSIGNMENT_STATUS.CANCELLED;
    claimed.cancelledAt = new Date();
    claimed.cancellationReason = 'Order was already assigned to another delivery partner';
    await claimed.save();
    throw ApiError.conflict('This order was just assigned to another delivery partner');
  }

  claimed.status = DELIVERY_ASSIGNMENT_STATUS.ASSIGNED;
  claimed.assignedAt = new Date();
  await claimed.save();

  // Customer-facing: their order is now genuinely out for delivery, and its OTP
  // (just generated above, in the very same atomic update) is ready to view —
  // never the OTP digits themselves, only that it's ready (see
  // NOTIFICATION_TYPE.DELIVERY_OTP_REQUIRED's own comment in
  // notification.service.js). Restaurant-facing: a rider is now on the way to
  // pick up, a distinct, non-redundant fact from what the customer needed to know.
  const notifyData = { orderId: order._id, orderNumber: order.orderNumber };
  await notificationService.notify({
    recipient: order.user,
    type: NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY,
    data: notifyData,
    eventKey: `ORDER:${order._id}:OUT_FOR_DELIVERY:${order.user}`,
  });
  await notificationService.notify({
    recipient: order.user,
    type: NOTIFICATION_TYPE.DELIVERY_OTP_REQUIRED,
    data: notifyData,
    eventKey: `DELIVERY:${order._id}:OTP_REQUIRED:${order.user}`,
  });
  const restaurant = await Restaurant.findById(order.restaurant).select('owner');
  if (restaurant) {
    await notificationService.notify({
      recipient: restaurant.owner,
      type: NOTIFICATION_TYPE.DELIVERY_ACCEPTED,
      data: notifyData,
      eventKey: `DELIVERY:${claimed._id}:ACCEPTED:${restaurant.owner}`,
    });
  }

  return { assignment: claimed, order };
}

// The rider's OTP-verified delivery completion — the ONLY way this milestone lets
// a rider (as opposed to the restaurant/admin's pre-existing, unchanged manual
// PATCH /orders/:id/status path) mark their own assigned delivery DELIVERED.
//
// Two-phase, both phases atomic, exactly mirroring acceptAssignment's own two-step
// claim above — bcrypt/AES comparisons can't live inside a MongoDB query filter,
// so "verify the code" and "atomically transition" are necessarily separate steps,
// but each individual STATE MUTATION (the attempt-count increment, and the actual
// DELIVERED transition) is its own atomic findOneAndUpdate:
//   1) atomically claim one verification ATTEMPT (increments deliveryOtpAttempts
//      and returns the current ciphertext in the same operation) — this is what
//      makes concurrent verification attempts safe: every concurrent request
//      serializes through this single atomic increment, so attempts are counted
//      exactly once each, never lost or double-counted.
//   2) only if the decrypted code actually matches, atomically claim the ORDER
//      itself (still OUT_FOR_DELIVERY, still this rider) — this is what prevents
//      duplicate completion: if two requests somehow both had the correct code
//      (e.g. a genuine double-submit), only the first one's update can possibly
//      match, since it immediately moves orderStatus off OUT_FOR_DELIVERY; the
//      second gets a clear "already delivered" conflict instead of re-processing.
async function verifyDeliveryOtp(rider, assignmentId, submittedOtp) {
  if (rider.accountStatus !== DELIVERY_ACCOUNT_STATUS.ACTIVE) throw ApiError.badRequest('Your account is not active');
  if (rider.kycStatus !== DELIVERY_KYC_STATUS.VERIFIED) throw ApiError.badRequest('Your KYC is not verified');

  const assignment = await DeliveryAssignment.findById(assignmentId);
  if (!assignment) throw ApiError.notFound('Delivery assignment not found');
  if (assignment.deliveryPartner.toString() !== rider._id.toString()) throw ApiError.forbidden('This assignment does not belong to you');
  if (assignment.status !== DELIVERY_ASSIGNMENT_STATUS.ASSIGNED) {
    throw ApiError.badRequest(`This delivery is not currently active (status: "${assignment.status}")`);
  }

  const now = new Date();
  const claimed = await Order.findOneAndUpdate(
    {
      _id: assignment.order,
      deliveryPartner: rider._id,
      orderStatus: ORDER_STATUS.OUT_FOR_DELIVERY,
      deliveryOtpCipher: { $ne: null },
      deliveryOtpExpiresAt: { $gt: now },
      deliveryOtpAttempts: { $lt: deliveryOtpService.MAX_ATTEMPTS },
    },
    { $inc: { deliveryOtpAttempts: 1 } },
    { new: true, select: '+deliveryOtpCipher +deliveryOtpExpiresAt +deliveryOtpAttempts' }
  );

  if (!claimed) {
    // A precise, non-sensitive reason for the common cases; a generic message for
    // the rare concurrent-edge-case fallback (see the long comment in the model
    // about an admin cancelling the assignment in the same instant) — never
    // reveals the OTP itself or confirms a partial match either way.
    const current = await Order.findById(assignment.order).select('+deliveryOtpCipher +deliveryOtpExpiresAt +deliveryOtpAttempts');
    if (!current || current.orderStatus !== ORDER_STATUS.OUT_FOR_DELIVERY) {
      throw ApiError.badRequest('This delivery is not currently awaiting OTP verification');
    }
    if (!current.deliveryOtpCipher) throw ApiError.badRequest('No delivery OTP has been generated for this order yet');
    if (current.deliveryOtpAttempts >= deliveryOtpService.MAX_ATTEMPTS) {
      throw ApiError.badRequest('Too many incorrect attempts — this OTP is now locked. Ask the restaurant or support for help.');
    }
    throw ApiError.badRequest('This delivery OTP has expired');
  }

  const expectedOtp = deliveryOtpService.decryptOtp(claimed.deliveryOtpCipher);
  const isCorrect = expectedOtp !== null && deliveryOtpService.safeEqual(submittedOtp, expectedOtp);

  if (!isCorrect) {
    const remaining = Math.max(0, deliveryOtpService.MAX_ATTEMPTS - claimed.deliveryOtpAttempts);
    throw ApiError.badRequest(
      remaining > 0 ? `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.` : 'Incorrect OTP. This OTP is now locked.'
    );
  }

  const order = await Order.findOneAndUpdate(
    { _id: assignment.order, deliveryPartner: rider._id, orderStatus: ORDER_STATUS.OUT_FOR_DELIVERY },
    {
      $set: { orderStatus: ORDER_STATUS.DELIVERED, deliveryOtpVerifiedAt: now, deliveryOtpCipher: null },
      $push: { statusHistory: { status: ORDER_STATUS.DELIVERED, changedBy: rider.user } },
    },
    { new: true }
  );
  if (!order) throw ApiError.conflict('This order has already been marked delivered');

  // The exact same M7/M8 hook the restaurant/admin's own manual completion path
  // already triggers — it atomically flips the assignment to COMPLETED and emits
  // tracking:ended. One place decides "what happens when an order is delivered",
  // never duplicated here — including the customer's ORDER_DELIVERED
  // notification/email, now sent from inside onOrderStatusChanged itself
  // rather than a second, separate ad hoc email call here.
  await onOrderStatusChanged(order, { _id: rider.user });

  const completedAssignment = await DeliveryAssignment.findById(assignment._id);
  return { order, assignment: completedAssignment };
}

async function rejectAssignment(rider, assignmentId, reason) {
  const now = new Date();
  const assignment = await DeliveryAssignment.findOneAndUpdate(
    { _id: assignmentId, deliveryPartner: rider._id, status: DELIVERY_ASSIGNMENT_STATUS.OFFERED },
    { $set: { status: DELIVERY_ASSIGNMENT_STATUS.REJECTED, respondedAt: now, rejectedAt: now, rejectionReason: reason || null } },
    { new: true }
  );
  if (!assignment) throw ApiError.badRequest('This offer is no longer available to respond to');

  // Best-effort immediate reassignment — a rejection must never fail because
  // nobody else happens to be available right now; the order simply stays
  // READY_FOR_PICKUP for the restaurant to fall back on, or for an admin retry.
  const order = await Order.findById(assignment.order);
  if (order) {
    try {
      await dispatchOrder(order);
    } catch (err) {
      console.error(`Reassignment after rejection failed for order ${order.orderNumber}:`, err.message);
    }
  }

  return assignment;
}

async function cancelAssignment(id, actor, reason) {
  const assignment = await DeliveryAssignment.findById(id);
  if (!assignment) throw ApiError.notFound('Delivery assignment not found');
  if (!ACTIVE_ASSIGNMENT_STATUSES.includes(assignment.status)) {
    throw ApiError.badRequest(`Cannot cancel an assignment in status "${assignment.status}"`);
  }

  const wasAssigned = assignment.status === DELIVERY_ASSIGNMENT_STATUS.ASSIGNED;
  assignment.status = DELIVERY_ASSIGNMENT_STATUS.CANCELLED;
  assignment.cancelledAt = new Date();
  assignment.cancelledBy = actor._id;
  assignment.cancellationReason = reason || null;
  await assignment.save();

  // If this assignment had actually claimed the order, free it back up so it can
  // be redispatched (order status is deliberately left as-is — an admin cancelling
  // a rider's assignment doesn't retroactively un-cook the food), and tell anyone
  // watching this delivery live that it has stopped.
  if (wasAssigned) {
    const order = await Order.findOneAndUpdate(
      { _id: assignment.order, deliveryPartner: assignment.deliveryPartner },
      { $set: { deliveryPartner: null } },
      { new: true }
    );
    emitTrackingEnded({ orderId: assignment.order, assignmentId: assignment._id, reason: 'cancelled' });

    // Only when the ORDER itself is still otherwise proceeding — i.e. a genuine
    // admin "pull this rider off, we'll find another" action (cancelDeliveryAssignment).
    // When this same function runs as onOrderStatusChanged's own cleanup for an
    // order that just became CANCELLED/REJECTED, the customer already gets that
    // order-level notification directly from order.service.js — a second one
    // here would be redundant/confusing.
    if (order && ![ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED].includes(order.orderStatus)) {
      await notificationService.notify({
        recipient: order.user,
        type: NOTIFICATION_TYPE.DELIVERY_REJECTED,
        data: { orderId: order._id, orderNumber: order.orderNumber },
        eventKey: `DELIVERY:${assignment._id}:REJECTED:${order.user}`,
      });
    }
  }

  return assignment;
}

// Called from order.service.js whenever an order leaves the dispatch-relevant
// flow (cancelled, rejected, or reaches DELIVERED) — never throws, mirroring
// autoRefundIfPaid's "never block the state change that triggered this" rule.
async function onOrderStatusChanged(order, actor) {
  try {
    if (order.orderStatus === ORDER_STATUS.DELIVERED) {
      const completed = await DeliveryAssignment.findOneAndUpdate(
        { order: order._id, status: DELIVERY_ASSIGNMENT_STATUS.ASSIGNED },
        { $set: { status: DELIVERY_ASSIGNMENT_STATUS.COMPLETED, completedAt: new Date() } },
        { new: true }
      );
      if (completed) {
        emitTrackingEnded({ orderId: order._id, assignmentId: completed._id, reason: 'delivered' });
        // M10 — the single, shared point both the OTP-verify path and the
        // restaurant/admin manual-completion fallback funnel through, so a
        // rider earns identically either way. Never blocks/undoes the delivery
        // completion itself if this somehow fails — see the outer try/catch.
        const earning = await deliveryEarningService.createEarningForCompletedDelivery(order, completed);
        const rider = await DeliveryPartner.findById(completed.deliveryPartner).select('user');
        if (rider) {
          await notificationService.notify({
            recipient: rider.user,
            type: NOTIFICATION_TYPE.DELIVERY_COMPLETED,
            data: { orderId: order._id, orderNumber: order.orderNumber, netAmount: earning ? earning.netAmount : null },
            eventKey: `DELIVERY:${completed._id}:COMPLETED:${rider.user}`,
          });
        }
      }
      // Customer-facing — fires for EVERY order that reaches DELIVERED,
      // regardless of whether a rider was ever involved (self-delivery via the
      // restaurant/admin's manual completion path has no `completed` assignment
      // at all, but the customer still needs to know their order arrived).
      await notificationService.notify({
        recipient: order.user,
        type: NOTIFICATION_TYPE.ORDER_DELIVERED,
        data: { orderId: order._id, orderNumber: order.orderNumber },
        eventKey: `ORDER:${order._id}:DELIVERED:${order.user}`,
      });
      return;
    }
    if ([ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED].includes(order.orderStatus)) {
      const active = await DeliveryAssignment.find({ order: order._id, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } });
      await Promise.all(
        active.map((a) => cancelAssignment(a._id, actor, `Order was ${order.orderStatus.toLowerCase()}`))
      );
    }
  } catch (err) {
    console.error(`Delivery-assignment cleanup failed for order ${order.orderNumber}:`, err.message);
  }
}

async function listForRider(rider, query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { deliveryPartner: rider._id };
  if (query.status) filter.status = query.status;

  const [items, total] = await Promise.all([
    DeliveryAssignment.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate({ path: 'order', select: 'orderNumber restaurant deliveryAddress totalAmount paymentMethod orderStatus', populate: { path: 'restaurant', select: 'name address city' } }),
    DeliveryAssignment.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

// Before a rider commits to an offer they see only enough to decide (area, not
// the exact address, and never the customer's name/phone) — full delivery
// details are only revealed once they've actually accepted (currentDeliveryForRider).
async function currentOffersForRider(rider) {
  await DeliveryAssignment.updateMany(
    { deliveryPartner: rider._id, status: DELIVERY_ASSIGNMENT_STATUS.OFFERED, expiresAt: { $lte: new Date() } },
    { $set: { status: DELIVERY_ASSIGNMENT_STATUS.EXPIRED } }
  );
  return DeliveryAssignment.find({ deliveryPartner: rider._id, status: DELIVERY_ASSIGNMENT_STATUS.OFFERED, expiresAt: { $gt: new Date() } })
    .sort('-offeredAt')
    .populate({
      path: 'order',
      select: 'orderNumber restaurant deliveryAddress.city deliveryAddress.state totalAmount paymentMethod',
      populate: { path: 'restaurant', select: 'name address city' },
    });
}

async function currentDeliveryForRider(rider) {
  return DeliveryAssignment.findOne({ deliveryPartner: rider._id, status: DELIVERY_ASSIGNMENT_STATUS.ASSIGNED }).populate({
    path: 'order',
    select: 'orderNumber restaurant deliveryAddress totalAmount paymentMethod orderStatus',
    populate: { path: 'restaurant', select: 'name address city' },
  });
}

async function assertOwnAssignment(rider, assignmentId) {
  const assignment = await DeliveryAssignment.findById(assignmentId);
  if (!assignment) throw ApiError.notFound('Delivery assignment not found');
  if (assignment.deliveryPartner.toString() !== rider._id.toString()) throw ApiError.forbidden('This assignment does not belong to you');
  return assignment;
}

async function listForAdmin(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.order) filter.order = query.order;
  if (query.deliveryPartner) filter.deliveryPartner = query.deliveryPartner;

  const [items, total] = await Promise.all([
    DeliveryAssignment.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('deliveryPartner', PUBLIC_RIDER_FIELDS)
      .populate('order', 'orderNumber orderStatus totalAmount'),
    DeliveryAssignment.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function listEligibleRidersForOrder(orderId) {
  const order = await Order.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  const restaurant = await Restaurant.findById(order.restaurant);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  const excludeIds = await busyRiderIds();
  return findEligibleRiders(restaurant, { excludeIds, limit: 20 });
}

module.exports = {
  OFFER_TTL_MS,
  PUBLIC_RIDER_FIELDS,
  findEligibleRiders,
  dispatchOrder,
  adminAssign,
  acceptAssignment,
  verifyDeliveryOtp,
  rejectAssignment,
  cancelAssignment,
  onOrderStatusChanged,
  listForRider,
  currentOffersForRider,
  currentDeliveryForRider,
  assertOwnAssignment,
  listForAdmin,
  listEligibleRidersForOrder,
};
