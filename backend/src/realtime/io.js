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

module.exports = { setIO, getIO, orderRoom, deliveryRoom, userRoom, emitTrackingEnded };
