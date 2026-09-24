// A plain holder for the single Socket.IO server instance, set once by
// realtime/index.js at boot, plus the room-naming and generic emit helpers.
// Deliberately has NO other requires (not even a model or another service) so
// ANY service can import it — including deliveryAssignment.service.js, which
// order.service.js itself requires — without risking a require cycle. (An
// earlier draft had deliveryAssignment.service.js import these from
// socketHandlers.js, which transitively requires order.service.js — a genuine
// cycle, since order.service.js requires deliveryAssignment.service.js. Fixed
// by keeping everything cycle-sensitive in this dependency-free module instead.)
let io = null;

function setIO(instance) {
  io = instance;
}

// Returns null if Socket.IO hasn't been initialized (e.g. in the Jest test
// environment for suites that don't start it) — every caller must treat a null
// return as "nobody to notify" rather than throwing, exactly like the rest of
// this codebase treats a best-effort side-channel (see autoRefundIfPaid).
function getIO() {
  return io;
}

const orderRoom = (orderId) => `order:${orderId}`;
const deliveryRoom = (assignmentId) => `delivery:${assignmentId}`;
const userRoom = (userId) => `user:${userId}`;

// Emitted whenever an assignment leaves ASSIGNED for a reason other than
// progressing normally (delivered, cancelled) — see deliveryAssignment.service.js
// — so a customer's open tracking view stops showing "Live" instead of just
// going silent with no explanation. Best-effort: a null io (Socket.IO not
// started) must never fail the order/assignment update that triggered this.
function emitTrackingEnded({ orderId, assignmentId, reason }) {
  if (!io) return;
  io.to(orderRoom(orderId.toString()))
    .to(deliveryRoom(assignmentId.toString()))
    .emit('tracking:ended', { orderId: orderId.toString(), assignmentId: assignmentId.toString(), reason });
}

// M12 — the one place a notification ever reaches a socket. Every authenticated
// connection already auto-joins its own userRoom (see realtime/socketHandlers.js),
// so there is no separate "subscribe to notifications" step and no way for a
// client to ask to receive someone else's — the room name is only ever derived
// from a server-resolved recipient id (notification.service.js), never from
// anything a client sends. Best-effort, like emitTrackingEnded: a null io (not
// started, or in a test that never calls initSocket) must never fail the
// business operation that triggered this notification.
function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(userRoom(userId.toString())).emit(event, payload);
}

module.exports = { setIO, getIO, orderRoom, deliveryRoom, userRoom, emitTrackingEnded, emitToUser };
