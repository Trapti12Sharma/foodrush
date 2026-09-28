const Notification = require('../models/Notification');
const NotificationPreference = require('../models/NotificationPreference');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const emailService = require('./email.service');
const { emitToUser } = require('../realtime/io');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { NOTIFICATION_TYPE, NOTIFICATION_EMAIL_STATUS, NOTIFICATION_PREFERENCE_FIELD } = require('../utils/constants');
const { PERMISSIONS, hasPermission, STAFF_ROLES } = require('../utils/permissions');

const MAX_EMAIL_ATTEMPTS = Number(process.env.NOTIFICATION_EMAIL_MAX_ATTEMPTS) || 3;

// Every business event's in-app copy lives here, and ONLY here — the single
// place that decides what a notification says, so the same event reads
// identically whether it was triggered from order.service.js, refund.service.js,
// or anywhere else (Part 25's stated architecture goal). Callers pass `data`;
// an explicit `title`/`message` (rare) overrides this entirely.
const CONTENT = {
  [NOTIFICATION_TYPE.ORDER_PLACED]: (d) => ({ title: 'Order placed', message: `Your order ${d.orderNumber} has been placed.` }),
  [NOTIFICATION_TYPE.ORDER_CONFIRMED]: (d) => ({ title: 'Order confirmed', message: `Your order ${d.orderNumber} has been confirmed by the restaurant.` }),
  [NOTIFICATION_TYPE.ORDER_REJECTED]: (d) => ({ title: 'Order rejected', message: `Your order ${d.orderNumber} was rejected by the restaurant.` }),
  [NOTIFICATION_TYPE.ORDER_CANCELLED]: (d) => ({ title: 'Order cancelled', message: `Order ${d.orderNumber} has been cancelled.` }),
  [NOTIFICATION_TYPE.ORDER_READY]: (d) => ({ title: 'Order ready', message: `Your order ${d.orderNumber} is ready and will be picked up soon.` }),
  [NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY]: (d) => ({ title: 'Out for delivery', message: `Your order ${d.orderNumber} is out for delivery.` }),
  [NOTIFICATION_TYPE.ORDER_DELIVERED]: (d) => ({ title: 'Order delivered', message: `Your order ${d.orderNumber} has been delivered. Enjoy!` }),

  [NOTIFICATION_TYPE.PAYMENT_SUCCESS]: (d) => ({ title: 'Payment successful', message: `Payment of ₹${d.amount} received for order ${d.orderNumber}.` }),
  [NOTIFICATION_TYPE.PAYMENT_FAILED]: (d) => ({ title: 'Payment failed', message: `Your payment for order ${d.orderNumber} could not be completed.` }),
  [NOTIFICATION_TYPE.PAYMENT_RETRY_REQUIRED]: (d) => ({ title: 'Payment incomplete', message: `Your payment for order ${d.orderNumber} didn't go through. You can retry it now.` }),
  [NOTIFICATION_TYPE.REFUND_CREATED]: (d) => ({ title: 'Refund started', message: `A refund of ₹${d.amount} for order ${d.orderNumber} has been started.` }),
  [NOTIFICATION_TYPE.REFUND_FAILED]: (d) => ({ title: 'Refund issue', message: `We hit an issue refunding order ${d.orderNumber}. Our team has been notified.` }),
  [NOTIFICATION_TYPE.REFUND_COMPLETED]: (d) => ({ title: 'Refund completed', message: `Your refund of ₹${d.amount} for order ${d.orderNumber} is complete.` }),

  [NOTIFICATION_TYPE.DELIVERY_ASSIGNED]: (d) => ({ title: 'New delivery offer', message: `You have a new delivery offer for order ${d.orderNumber}.` }),
  [NOTIFICATION_TYPE.DELIVERY_ACCEPTED]: (d) => ({ title: 'Rider on the way', message: `A rider has accepted order ${d.orderNumber} and is heading to pick it up.` }),
  [NOTIFICATION_TYPE.DELIVERY_REJECTED]: (d) => ({ title: 'Delivery declined', message: `A rider declined order ${d.orderNumber}.` }),
  [NOTIFICATION_TYPE.DELIVERY_STARTED]: (d) => ({ title: 'Delivery started', message: `Delivery has started for order ${d.orderNumber}.` }),
  [NOTIFICATION_TYPE.DELIVERY_COMPLETED]: (d) => ({
    title: 'Delivery completed',
    message: `You completed delivery for order ${d.orderNumber}${d.netAmount != null ? ` — you earned ₹${d.netAmount}` : ''}.`,
  }),
  [NOTIFICATION_TYPE.DELIVERY_OTP_REQUIRED]: (d) => ({
    title: 'Delivery OTP ready',
    message: `Your delivery OTP for order ${d.orderNumber} is ready. View it from your order and share it with your rider on arrival.`,
  }),

  [NOTIFICATION_TYPE.SUPPORT_TICKET_CREATED]: (d) => ({ title: 'Support ticket received', message: `Ticket ${d.ticketNumber} has been received.` }),
  [NOTIFICATION_TYPE.SUPPORT_TICKET_ASSIGNED]: (d) => ({ title: 'Ticket assigned to you', message: `Support ticket ${d.ticketNumber} has been assigned to you.` }),
  [NOTIFICATION_TYPE.SUPPORT_TICKET_REPLIED]: (d) => ({ title: 'New reply', message: `There's a new reply on ticket ${d.ticketNumber}.` }),
  [NOTIFICATION_TYPE.SUPPORT_TICKET_RESOLVED]: (d) => ({ title: 'Ticket resolved', message: `Ticket ${d.ticketNumber} has been marked resolved.` }),
  [NOTIFICATION_TYPE.SUPPORT_TICKET_CLOSED]: (d) => ({ title: 'Ticket closed', message: `Ticket ${d.ticketNumber} has been closed.` }),

  [NOTIFICATION_TYPE.SETTLEMENT_GENERATED]: (d) => ({ title: 'Settlement generated', message: `A settlement of ₹${d.netAmount} has been generated for you.` }),
  [NOTIFICATION_TYPE.SETTLEMENT_APPROVED]: (d) => ({ title: 'Settlement approved', message: `Your settlement of ₹${d.netAmount} has been approved.` }),
  [NOTIFICATION_TYPE.SETTLEMENT_PAID]: (d) => ({ title: 'Settlement paid', message: `Your settlement of ₹${d.netAmount} has been marked paid.` }),
  [NOTIFICATION_TYPE.SETTLEMENT_FAILED]: (d) => ({ title: 'Settlement issue', message: `There was an issue with your settlement payout${d.reason ? ` (${d.reason})` : ''}.` }),

  [NOTIFICATION_TYPE.RESTAURANT_KYC_SUBMITTED]: (d) => ({ title: 'KYC submitted for review', message: `${d.restaurantName || 'A restaurant'} submitted business-verification documents for review.` }),
  [NOTIFICATION_TYPE.RESTAURANT_KYC_VERIFIED]: (d) => ({ title: 'KYC verified', message: `Your restaurant's business documents have been verified.` }),
  [NOTIFICATION_TYPE.RESTAURANT_KYC_REJECTED]: (d) => ({ title: 'KYC needs attention', message: `Your restaurant's KYC submission was rejected${d.reason ? ` (${d.reason})` : ''}. Please review and resubmit.` }),

  [NOTIFICATION_TYPE.REVIEW_APPROVED]: () => ({ title: 'Your review is live', message: 'Your review has been approved and is now visible to other customers.' }),
  [NOTIFICATION_TYPE.REVIEW_REJECTED]: (d) => ({ title: 'Your review was not approved', message: `Your review could not be published${d.reason ? ` (${d.reason})` : ''}.` }),
  [NOTIFICATION_TYPE.REVIEW_HIDDEN]: (d) => ({ title: 'Your review was hidden', message: `Your review is no longer visible to other customers${d.reason ? ` (${d.reason})` : ''}.` }),
  [NOTIFICATION_TYPE.REVIEW_RESTORED]: () => ({ title: 'Your review is visible again', message: 'Your review has been restored and is visible to other customers again.' }),

  [NOTIFICATION_TYPE.ACCOUNT_SECURITY]: (d) => ({ title: 'Security alert', message: d.message || 'A security-relevant change was made to your account.' }),
  [NOTIFICATION_TYPE.SYSTEM]: (d) => ({ title: 'FoodRush', message: d.message || 'You have a new notification.' }),
};

function buildContent(type, data) {
  const builder = CONTENT[type];
  return builder ? builder(data || {}) : { title: 'Notification', message: 'You have a new notification.' };
}

// Only the events explicitly given an email template (email.service.js) ever
// attempt the email channel — everything else is in-app/socket only by design
// (see utils/constants.js NOTIFICATION_PREFERENCE_FIELD's comment for why, e.g.
// DELIVERY_OTP_REQUIRED is deliberately absent here: never email anything
// OTP-adjacent beyond the existing, authoritative in-app retrieval flow).
const EMAIL_TEMPLATES = {
  [NOTIFICATION_TYPE.ORDER_PLACED]: emailService.orderPlacedEmail,
  [NOTIFICATION_TYPE.ORDER_CONFIRMED]: emailService.orderConfirmedEmail,
  [NOTIFICATION_TYPE.ORDER_REJECTED]: emailService.orderRejectedEmail,
  [NOTIFICATION_TYPE.ORDER_CANCELLED]: emailService.orderCancelledEmail,
  [NOTIFICATION_TYPE.ORDER_OUT_FOR_DELIVERY]: emailService.orderOutForDeliveryEmail,
  [NOTIFICATION_TYPE.ORDER_DELIVERED]: emailService.orderDeliveredEmail,
  [NOTIFICATION_TYPE.PAYMENT_SUCCESS]: emailService.paymentSuccessEmail,
  [NOTIFICATION_TYPE.PAYMENT_FAILED]: emailService.paymentFailedEmail,
  [NOTIFICATION_TYPE.PAYMENT_RETRY_REQUIRED]: emailService.paymentRetryRequiredEmail,
  [NOTIFICATION_TYPE.REFUND_CREATED]: emailService.refundCreatedEmail,
  [NOTIFICATION_TYPE.REFUND_FAILED]: emailService.refundFailedEmail,
  [NOTIFICATION_TYPE.REFUND_COMPLETED]: emailService.refundCompletedEmail,
  [NOTIFICATION_TYPE.DELIVERY_ASSIGNED]: emailService.deliveryAssignedEmail,
  [NOTIFICATION_TYPE.SUPPORT_TICKET_CREATED]: emailService.supportTicketCreatedEmail,
  [NOTIFICATION_TYPE.SUPPORT_TICKET_REPLIED]: emailService.supportTicketReplyEmail,
  [NOTIFICATION_TYPE.SUPPORT_TICKET_RESOLVED]: emailService.supportTicketResolvedEmail,
  [NOTIFICATION_TYPE.SETTLEMENT_PAID]: emailService.settlementPaidEmail,
  [NOTIFICATION_TYPE.SETTLEMENT_FAILED]: emailService.settlementFailedEmail,
};

// Dropped entirely (not just redacted, unlike the audit trail — this is
// user-facing) if a caller's `data` ever accidentally included something
// credential/OTP-shaped. Defense in depth: no legitimate call site needs any of
// these, but `data` flows straight into the Notification row, the socket
// payload, AND an email template's arguments, so this is the one gate all three
// pass through.
const SENSITIVE_KEY = /pass(word)?|secret|token|authoriz|cookie|otp|api[-_]?key|signature|jwt/i;
function sanitizeData(data) {
  if (!data || typeof data !== 'object') return {};
  const out = {};
  Object.entries(data).forEach(([key, value]) => {
    if (SENSITIVE_KEY.test(key) || value === undefined) return;
    out[key] = value;
  });
  return out;
}

function toSocketPayload(notification) {
  return {
    id: notification._id.toString(),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    data: notification.data,
    createdAt: notification.createdAt,
  };
}

// `recipient` may already be a full {_id, role, name, email} (most callers have
// the User loaded), or just an id/ObjectId — resolved here so every call site
// doesn't repeat the same lookup. Returns null (never throws) for a recipient
// that no longer exists — a deleted/deactivated account must not break whatever
// business event tried to notify it.
async function resolveRecipient(recipient) {
  if (recipient && recipient.email && recipient.role) return recipient;
  const id = recipient && recipient._id ? recipient._id : recipient;
  if (!id) return null;
  return User.findById(id).select('name email role');
}

async function isEmailAllowed(userId, type) {
  const field = NOTIFICATION_PREFERENCE_FIELD[type];
  if (!field) return true; // mandatory type (ACCOUNT_SECURITY/SYSTEM) — never gated
  const pref = await NotificationPreference.findOne({ user: userId }).lean();
  if (!pref) return true; // no row yet => the schema's own defaults (all true except marketing)
  return pref[field] !== false;
}

// Best-effort, synchronous, single attempt — no queue/worker (see Part 14: no
// Redis/BullMQ, no fake background worker). `emailAttempts`/`emailStatus`/etc.
// on the Notification row are the entire "retry architecture": a failed send is
// recorded, not silently lost, and retryFailedEmail() below can be called again
// later (by an admin action or a future scheduled task) up to MAX_EMAIL_ATTEMPTS.
async function attemptEmail(notification, recipientUser) {
  const builder = EMAIL_TEMPLATES[notification.type];
  if (!builder || !emailService.isEmailConfigured()) {
    notification.emailStatus = NOTIFICATION_EMAIL_STATUS.SKIPPED;
    return notification.save();
  }
  const allowed = await isEmailAllowed(notification.recipient, notification.type);
  if (!allowed) {
    notification.emailStatus = NOTIFICATION_EMAIL_STATUS.SKIPPED;
    return notification.save();
  }

  notification.emailAttempts += 1;
  notification.lastEmailAttemptAt = new Date();
  try {
    const { subject, text, html } = builder({ name: recipientUser.name, ...notification.data });
    await emailService.sendMail({ to: recipientUser.email, subject, text, html });
    notification.emailStatus = NOTIFICATION_EMAIL_STATUS.SENT;
    notification.emailSentAt = new Date();
    notification.emailError = null;
  } catch (err) {
    // Never the business operation's problem — logged and recorded on the
    // notification itself, nothing more. See the big try/catch in notify().
    notification.emailStatus = NOTIFICATION_EMAIL_STATUS.FAILED;
    notification.emailError = (err.message || 'Unknown error').slice(0, 300);
    console.error(`Notification email failed (type=${notification.type}, recipient=${notification.recipient}):`, err.message);
  }
  return notification.save();
}

// The single entry point every business service calls — order/payment/refund/
// delivery-assignment/delivery-OTP/support-ticket/settlement services all funnel
// through here, never build their own ad hoc sendEmail/socket.emit calls (Part 25).
//
// `eventKey`, when given, is this event's idempotency key (Part 12) — e.g.
// "ORDER:<orderId>:PLACED:<recipientId>". A duplicate call (a retried request, a
// webhook redelivered, a controller accidentally invoked twice) hits the
// model's unique+sparse index and this returns the ALREADY-existing
// notification instead of creating a second one or throwing.
//
// Wrapped in one big try/catch, on purpose: nothing in here — a bad recipient, a
// duplicate key, a socket emit failure, an email provider outage — may ever
// propagate out and fail the order/payment/refund/etc. operation that called
// this (Part 13). A total failure logs and returns null.
async function notify({ recipient, type, data = {}, title, message, eventKey }) {
  try {
    const user = await resolveRecipient(recipient);
    if (!user) return null;

    const content = title && message ? { title, message } : buildContent(type, sanitizeData(data));
    const cleanData = sanitizeData(data);
    const emailRequested = Boolean(EMAIL_TEMPLATES[type]);

    let notification;
    try {
      notification = await Notification.create({
        recipient: user._id,
        recipientRole: user.role,
        type,
        title: content.title,
        message: content.message,
        data: cleanData,
        channels: { inApp: true, email: emailRequested },
        eventKey: eventKey || undefined,
      });
    } catch (err) {
      if (err.code === 11000) {
        // This exact event already notified this exact recipient — the
        // duplicate-protection design working as intended, not a real error.
        return Notification.findOne({ eventKey });
      }
      throw err;
    }

    try {
      emitToUser(user._id, 'notification:new', toSocketPayload(notification));
    } catch (err) {
      console.error('Socket notification emit failed:', err.message);
    }

    if (emailRequested) await attemptEmail(notification, user);

    return notification;
  } catch (err) {
    console.error(`notification.service.notify failed (type=${type}):`, err.message);
    return null;
  }
}

// Manual, on-demand retry — no automatic scheduler (Part 14). Capped so a
// permanently-broken address/provider can't be retried forever.
async function retryFailedEmail(notificationId) {
  const notification = await Notification.findById(notificationId);
  if (!notification) throw ApiError.notFound('Notification not found');
  if (notification.emailStatus !== NOTIFICATION_EMAIL_STATUS.FAILED) {
    throw ApiError.badRequest(`Cannot retry an email in status "${notification.emailStatus}"`);
  }
  if (notification.emailAttempts >= MAX_EMAIL_ATTEMPTS) {
    throw ApiError.badRequest(`This notification has already reached the maximum of ${MAX_EMAIL_ATTEMPTS} email attempts`);
  }
  const user = await User.findById(notification.recipient).select('name email role');
  if (!user) throw ApiError.notFound('Recipient no longer exists');
  await attemptEmail(notification, user);
  return notification;
}

// Broadcasts to every staff member holding `permission` (Part 16) — never every
// admin, never every user. `entityId` makes each staff member's own copy of the
// event idempotent independently (see the eventKey comment on notify()).
async function notifyStaff(permission, { type, data, entityId }) {
  try {
    const staff = await User.find({ role: { $in: STAFF_ROLES } }).select('name email role');
    const targets = staff.filter((u) => hasPermission(u, permission));
    await Promise.all(
      targets.map((u) => notify({ recipient: u, type, data, eventKey: entityId ? `${type}:${entityId}:STAFF:${u._id}` : undefined }))
    );
  } catch (err) {
    console.error(`notifyStaff failed (permission=${permission}, type=${type}):`, err.message);
  }
}

async function markAsRead(user, id) {
  const updated = await Notification.findOneAndUpdate(
    { _id: id, recipient: user._id, readAt: null },
    { $set: { readAt: new Date() } },
    { new: true }
  );
  if (updated) return updated;

  // Distinguishes "already read" (idempotent no-op, 200) from "not yours /
  // doesn't exist" (404) — never confirms existence to the wrong caller.
  const existing = await Notification.findOne({ _id: id, recipient: user._id });
  if (!existing) throw ApiError.notFound('Notification not found');
  return existing;
}

async function markAllAsRead(user) {
  const result = await Notification.updateMany({ recipient: user._id, readAt: null }, { $set: { readAt: new Date() } });
  return { modifiedCount: result.modifiedCount };
}

async function getUserNotifications(user, query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { recipient: user._id };
  if (query.type) filter.type = query.type;
  if (query.unread === 'true') filter.readAt = null;

  const [items, total] = await Promise.all([
    Notification.find(filter).sort('-createdAt').skip(skip).limit(limit).lean(),
    Notification.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getUnreadCount(user) {
  return Notification.countDocuments({ recipient: user._id, readAt: null });
}

async function getById(user, id) {
  const notification = await Notification.findOne({ _id: id, recipient: user._id }).lean();
  if (!notification) throw ApiError.notFound('Notification not found');
  return notification;
}

module.exports = {
  MAX_EMAIL_ATTEMPTS,
  notify,
  notifyStaff,
  retryFailedEmail,
  markAsRead,
  markAllAsRead,
  getUserNotifications,
  getUnreadCount,
  getById,
  buildContent,
  sanitizeData,
};
