const Order = require('../models/Order');
const DeliveryPartner = require('../models/DeliveryPartner');
const DeliveryAssignment = require('../models/DeliveryAssignment');
const orderService = require('../services/order.service');
const deliveryPartnerService = require('../services/deliveryPartner.service');
const { isValidLatitude, isValidLongitude } = require('../utils/geo');
const { orderRoom, deliveryRoom, userRoom } = require('./io');
const {
  ROLES,
  ORDER_STATUS,
  DELIVERY_ACCOUNT_STATUS,
  DELIVERY_KYC_STATUS,
  DELIVERY_ASSIGNMENT_STATUS,
} = require('../utils/constants');

// Per-rider (not per-socket — a reconnect must not reset the clock) minimum gap
// between ACCEPTED location updates. A rejected/throttled update is not an
// error — the ack still says ok, just throttled: true, so the client's own timer
// (whatever it is) never sees this as a failure to retry aggressively. Purely
// server-side and independent of whatever interval the client itself uses,
// exactly so a misbehaving or modified client can't flood Mongo/Socket.IO no
// matter what it sends.
const MIN_UPDATE_INTERVAL_MS = Number(process.env.LOCATION_UPDATE_MIN_INTERVAL_MS) || 5000;
const lastUpdateAt = new Map(); // riderId (string) -> ms timestamp

function ackOk(cb, extra = {}) {
  if (typeof cb === 'function') cb({ ok: true, ...extra });
}
function ackErr(cb, message) {
  if (typeof cb === 'function') cb({ ok: false, message });
}

// Same authorization order.service.js's REST endpoints use (canAccessOrder) —
// one rule, three transports (GET /orders/:id, GET /orders/:id/tracking, here).
async function loadAuthorizedOrder(socket, orderId) {
  const order = await Order.findById(orderId).populate('restaurant', 'owner').populate('deliveryPartner', '_id');
  if (!order) return null;
  const allowed = await orderService.canAccessOrder(socket.user, order);
  return allowed ? order : null;
}

function registerSocketHandlers(io, socket) {
  // Every authenticated socket gets a private room for future direct-to-user
  // events (e.g. a delivery-offer push) — no functional use yet in M8, but
  // costs nothing to set up correctly now rather than retrofit later.
  socket.join(userRoom(socket.user._id.toString()));

  // Customer / restaurant owner / assigned rider / admin asking to watch an
  // order's live tracking. A wrong or someone-else's order id joins nothing and
  // gets a generic "not found" — never confirms an order exists for an
  // unauthorized caller, matching the REST endpoints' own not-found-not-forbidden
  // convention.
  socket.on('join:order', async ({ orderId } = {}, cb) => {
    try {
      if (!orderId) return ackErr(cb, 'orderId is required');
      const order = await loadAuthorizedOrder(socket, orderId);
      if (!order) return ackErr(cb, 'Order not found');
      socket.join(orderRoom(orderId));
      return ackOk(cb);
    } catch (err) {
      return ackErr(cb, 'Could not join this order');
    }
  });

  // Same rule, entered via an assignment id instead of an order id (what the
  // rider's own "current delivery" view naturally has on hand).
  socket.on('join:delivery', async ({ assignmentId } = {}, cb) => {
    try {
      if (!assignmentId) return ackErr(cb, 'assignmentId is required');
      const assignment = await DeliveryAssignment.findById(assignmentId);
      if (!assignment) return ackErr(cb, 'Delivery assignment not found');
      const order = await loadAuthorizedOrder(socket, assignment.order);
      if (!order) return ackErr(cb, 'Delivery assignment not found');
      socket.join(deliveryRoom(assignmentId));
      return ackOk(cb);
    } catch (err) {
      return ackErr(cb, 'Could not join this delivery');
    }
  });

  // The rider's own real device location, captured by navigator.geolocation on
  // the client — never a coordinate the server invents. Every check below is
  // re-verified on EVERY update, not just once at delivery start, so a
  // suspension/KYC change/cancellation takes effect on the very next packet.
  socket.on('rider:location', async ({ latitude, longitude, accuracy } = {}, cb) => {
    try {
      if (socket.user.role !== ROLES.DELIVERY_PARTNER) return ackErr(cb, 'Only delivery partners can broadcast location');

      const rider = await DeliveryPartner.findOne({ user: socket.user._id });
      if (!rider) return ackErr(cb, 'No delivery partner profile');
      if (rider.accountStatus !== DELIVERY_ACCOUNT_STATUS.ACTIVE) return ackErr(cb, 'Your account is not active');
      if (rider.kycStatus !== DELIVERY_KYC_STATUS.VERIFIED) return ackErr(cb, 'Your KYC is not verified');

      const assignment = await DeliveryAssignment.findOne({ deliveryPartner: rider._id, status: DELIVERY_ASSIGNMENT_STATUS.ASSIGNED });
      if (!assignment) return ackErr(cb, 'You have no active delivery to broadcast location for');

      const order = await Order.findById(assignment.order);
      if (!order || order.orderStatus !== ORDER_STATUS.OUT_FOR_DELIVERY) {
        return ackErr(cb, 'This delivery is no longer active');
      }

      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!isValidLatitude(lat) || !isValidLongitude(lng)) return ackErr(cb, 'Invalid coordinates');

      const riderId = rider._id.toString();
      const now = Date.now();
      if (now - (lastUpdateAt.get(riderId) || 0) < MIN_UPDATE_INTERVAL_MS) {
        return ackOk(cb, { throttled: true }); // not an error — just too soon, silently dropped
      }
      lastUpdateAt.set(riderId, now);

      const updated = await deliveryPartnerService.updateMyLocation(socket.user, { latitude: lat, longitude: lng, accuracy });

      // Minimal payload — coordinates and ids only, never rider/customer PII.
      io.to(orderRoom(order._id.toString()))
        .to(deliveryRoom(assignment._id.toString()))
        .emit('location:update', {
          orderId: order._id.toString(),
          assignmentId: assignment._id.toString(),
          latitude: lat,
          longitude: lng,
          accuracy: accuracy != null ? Number(accuracy) : null,
          updatedAt: updated.lastLocationAt,
        });

      return ackOk(cb);
    } catch (err) {
      return ackErr(cb, 'Could not update location');
    }
  });

  socket.on('disconnect', () => {
    // Socket.IO removes room memberships automatically. Nothing else to clean up
    // here: the throttle map is keyed by rider id (survives reconnects on
    // purpose), and the rider's last-known location simply stays as-is in
    // DeliveryPartner — exactly the "recover on reconnect" behavior wanted.
  });
}

module.exports = { registerSocketHandlers, MIN_UPDATE_INTERVAL_MS };
