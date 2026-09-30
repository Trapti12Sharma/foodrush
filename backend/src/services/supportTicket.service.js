const mongoose = require('mongoose');
const SupportTicket = require('../models/SupportTicket');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const DeliveryAssignment = require('../models/DeliveryAssignment');
const DeliveryPartner = require('../models/DeliveryPartner');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { nextTicketNumber } = require('../utils/ticketNumber');
const { escapeRegex } = require('../utils/regex');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const notificationService = require('./notification.service');
const { PERMISSIONS, hasPermission } = require('../utils/permissions');
const {
  ROLES, SUPPORT_TICKET_STATUS, SUPPORT_TICKET_TRANSITIONS, SUPPORT_TICKET_OPEN_FOR_USER_REPLY, NOTIFICATION_TYPE,
} = require('../utils/constants');

// The atomic Counter increment (utils/ticketNumber.js) already makes each
// ticketNumber unique under real concurrency — this retry is defense in depth
// against the database's unique-index backstop ever actually firing, so a rare,
// unexplained collision becomes a working ticket instead of a 500.
const MAX_TICKET_NUMBER_ATTEMPTS = 3;

function assertTransition(ticket, nextStatus) {
  const allowed = SUPPORT_TICKET_TRANSITIONS[ticket.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(`Cannot move a ticket from "${ticket.status}" to "${nextStatus}"`);
  }
}

function assertUserMayReply(ticket) {
  if (!SUPPORT_TICKET_OPEN_FOR_USER_REPLY.includes(ticket.status)) {
    const hint = ticket.status === SUPPORT_TICKET_STATUS.CLOSED ? 'This ticket is closed.' : 'This ticket has been resolved. Ask support to reopen it if you still need help.';
    throw ApiError.badRequest(hint);
  }
}

// Verifies every optional relationship a ticket references entirely from the
// AUTHENTICATED caller's own records — never from a raw id the client asserts.
// Throws on any mismatch rather than silently dropping it, since a rejected
// relationship almost always means the caller is guessing at someone else's id
// (a different customer's order, a restaurant they don't own, a delivery they
// were never assigned).
async function resolveRelationships(user, { orderId, restaurantId }) {
  const result = { order: null, restaurant: null, deliveryPartner: null, customer: null };

  if (user.role === ROLES.CUSTOMER) result.customer = user._id;

  if (user.role === ROLES.DELIVERY_PARTNER) {
    const rider = await DeliveryPartner.findOne({ user: user._id });
    if (rider) result.deliveryPartner = rider._id;
  }

  if (orderId) {
    const order = await Order.findById(orderId).populate('restaurant', 'owner');
    if (!order) throw ApiError.badRequest('That order could not be found');

    const isStaff = hasPermission(user, PERMISSIONS.SUPPORT_TICKETS_MANAGE) || hasPermission(user, PERMISSIONS.ORDERS_READ_ALL);

    if (user.role === ROLES.CUSTOMER) {
      if (order.user.toString() !== user._id.toString()) throw ApiError.forbidden('You can only open a ticket about your own order');
    } else if (user.role === ROLES.RESTAURANT_OWNER) {
      if (!order.restaurant || order.restaurant.owner.toString() !== user._id.toString()) {
        throw ApiError.forbidden('You can only open a ticket about an order placed at your own restaurant');
      }
    } else if (user.role === ROLES.DELIVERY_PARTNER) {
      if (!result.deliveryPartner) throw ApiError.forbidden('You do not have a delivery partner profile');
      const wasAssigned = await DeliveryAssignment.exists({ order: order._id, deliveryPartner: result.deliveryPartner });
      if (!wasAssigned) throw ApiError.forbidden('You can only open a ticket about a delivery you were assigned');
    } else if (!isStaff) {
      throw ApiError.forbidden('You cannot open a ticket about this order');
    }

    result.order = order._id;
    // Always derived from the order itself, never trusted as a separate field —
    // gives every order-linked ticket a restaurant reference regardless of who opened it.
    result.restaurant = order.restaurant ? order.restaurant._id : null;
  }

  if (restaurantId && !result.restaurant) {
    if (user.role !== ROLES.RESTAURANT_OWNER) {
      throw ApiError.forbidden('Only a restaurant owner can open a ticket about a restaurant directly');
    }
    const restaurant = await Restaurant.findOne({ _id: restaurantId, owner: user._id });
    if (!restaurant) throw ApiError.forbidden('You can only open a ticket about your own restaurant');
    result.restaurant = restaurant._id;
  }

  return result;
}

async function createTicket(user, payload) {
  const { category, subject, description, priority, orderId, restaurantId, attachments } = payload;
  const relationships = await resolveRelationships(user, { orderId, restaurantId });

  const data = {
    createdBy: user._id,
    createdByRole: user.role,
    ...relationships,
    category,
    subject,
    description,
    ...(priority ? { priority } : {}),
    attachments: attachments || [],
  };

  let lastErr;
  let ticket;
  for (let attempt = 1; attempt <= MAX_TICKET_NUMBER_ATTEMPTS && !ticket; attempt += 1) {
    const ticketNumber = await nextTicketNumber();
    try {
      // eslint-disable-next-line no-await-in-loop
      ticket = await SupportTicket.create({ ...data, ticketNumber });
    } catch (err) {
      if (err.code !== 11000) throw err;
      lastErr = err;
    }
  }
  if (!ticket) throw lastErr || ApiError.internal('Could not generate a unique ticket number. Please try again.');

  const notifyData = { ticketId: ticket._id, ticketNumber: ticket.ticketNumber };
  await notificationService.notify({
    recipient: user,
    type: NOTIFICATION_TYPE.SUPPORT_TICKET_CREATED,
    data: notifyData,
    eventKey: `SUPPORT_TICKET:${ticket._id}:CREATED:${user._id}`,
  });
  // Nobody is assigned yet — every support-capable staff member is told a new
  // ticket needs triage (Part 16), never every admin.
  await notificationService.notifyStaff(PERMISSIONS.SUPPORT_TICKETS_MANAGE, {
    type: NOTIFICATION_TYPE.SUPPORT_TICKET_CREATED,
    data: notifyData,
    entityId: ticket._id,
  });

  return ticket;
}

async function listForUser(user, query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { createdBy: user._id };
  if (query.status) filter.status = query.status;
  if (query.category) filter.category = query.category;

  const [items, total] = await Promise.all([
    SupportTicket.find(filter).select('-messages').sort('-createdAt').skip(skip).limit(limit).lean(),
    SupportTicket.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getForUser(user, ticketId) {
  const ticket = await SupportTicket.findOne({ _id: ticketId, createdBy: user._id })
    .populate('assignedTo', 'name')
    .populate('order', 'orderNumber orderStatus')
    .populate('restaurant', 'name')
    .populate('messages.sender', 'name role');
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  return ticket;
}

async function addMessageAsUser(user, ticketId, { message, attachments }) {
  const ticket = await SupportTicket.findOne({ _id: ticketId, createdBy: user._id });
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  assertUserMayReply(ticket);

  const pushed = ticket.messages[ticket.messages.push({ sender: user._id, senderRole: user.role, message, attachments: attachments || [] }) - 1];
  await ticket.save();

  // Only the assigned staff member — nobody is "everyone on support" for a
  // single ticket's reply, and an unassigned ticket simply has nobody to tell
  // yet (the staff-wide SUPPORT_TICKET_CREATED notification already covers that).
  if (ticket.assignedTo) {
    await notificationService.notify({
      recipient: ticket.assignedTo,
      type: NOTIFICATION_TYPE.SUPPORT_TICKET_REPLIED,
      data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber },
      eventKey: `SUPPORT_TICKET:${ticket._id}:REPLIED:${pushed._id}:${ticket.assignedTo}`,
    });
  }

  return ticket;
}

async function closeForUser(user, ticketId) {
  const ticket = await SupportTicket.findOne({ _id: ticketId, createdBy: user._id });
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  assertTransition(ticket, SUPPORT_TICKET_STATUS.CLOSED);
  ticket.status = SUPPORT_TICKET_STATUS.CLOSED;
  ticket.closedAt = new Date();
  ticket.closedBy = user._id;
  await ticket.save();
  return ticket;
}

// --- Admin/staff (requires support_tickets:manage — enforced at the route) ---

async function listForAdmin(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.priority) filter.priority = query.priority;
  if (query.category) filter.category = query.category;
  if (query.role) filter.createdByRole = query.role;
  if (query.assignedTo) filter.assignedTo = query.assignedTo;
  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ subject: re }, { ticketNumber: re }];
  }
  if (query.orderNumber) {
    const order = await Order.findOne({ orderNumber: new RegExp(`^${escapeRegex(query.orderNumber)}$`, 'i') }).select('_id');
    // No matching order still applies a filter no ticket can satisfy, rather than
    // silently ignoring the search term and returning an unrelated page of results.
    filter.order = order ? order._id : new mongoose.Types.ObjectId();
  }

  const [items, total] = await Promise.all([
    SupportTicket.find(filter)
      .select('-messages -description')
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('createdBy', 'name email role')
      .populate('assignedTo', 'name email')
      .populate('order', 'orderNumber')
      .lean(),
    SupportTicket.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getForAdmin(ticketId) {
  const ticket = await SupportTicket.findById(ticketId)
    .populate('createdBy', 'name email role')
    .populate('assignedTo', 'name email')
    .populate('resolvedBy', 'name email')
    .populate('closedBy', 'name email')
    .populate('order', 'orderNumber orderStatus totalAmount')
    .populate('restaurant', 'name')
    .populate('deliveryPartner', 'fullName phone')
    .populate('messages.sender', 'name role');
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  return ticket;
}

async function updateStatusForAdmin(ticketId, nextStatus, admin) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  assertTransition(ticket, nextStatus);

  ticket.status = nextStatus;
  if (nextStatus === SUPPORT_TICKET_STATUS.RESOLVED) {
    ticket.resolvedAt = new Date();
    ticket.resolvedBy = admin._id;
  }
  if (nextStatus === SUPPORT_TICKET_STATUS.CLOSED) {
    ticket.closedAt = new Date();
    ticket.closedBy = admin._id;
  }
  // Reopening clears the earlier resolution bookkeeping — a ticket that is, right
  // now, back in progress must not still display a stale "resolved at ...".
  if (nextStatus === SUPPORT_TICKET_STATUS.IN_PROGRESS && ticket.resolvedAt) {
    ticket.resolvedAt = null;
    ticket.resolvedBy = null;
    ticket.resolution = null;
  }
  await ticket.save();

  // Both resolveForAdmin and closeForAdmin funnel through this one function —
  // one notification call covers both, at the single point the transition
  // actually happens. Reopening (-> IN_PROGRESS) and a plain PENDING->IN_PROGRESS
  // triage move are deliberately silent — neither is something the creator needs
  // a push for.
  if (nextStatus === SUPPORT_TICKET_STATUS.RESOLVED) {
    await notificationService.notify({
      recipient: ticket.createdBy,
      type: NOTIFICATION_TYPE.SUPPORT_TICKET_RESOLVED,
      data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber },
      eventKey: `SUPPORT_TICKET:${ticket._id}:RESOLVED:${ticket.createdBy}`,
    });
  }
  if (nextStatus === SUPPORT_TICKET_STATUS.CLOSED) {
    await notificationService.notify({
      recipient: ticket.createdBy,
      type: NOTIFICATION_TYPE.SUPPORT_TICKET_CLOSED,
      data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber },
      eventKey: `SUPPORT_TICKET:${ticket._id}:CLOSED:${ticket.createdBy}`,
    });
  }

  return ticket;
}

async function updatePriorityForAdmin(ticketId, priority) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  ticket.priority = priority;
  await ticket.save();
  return ticket;
}

async function assignForAdmin(ticketId, assignedToId) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw ApiError.notFound('Support ticket not found');

  if (!assignedToId) {
    ticket.assignedTo = null;
    await ticket.save();
    return ticket;
  }

  const assignee = await User.findById(assignedToId);
  if (!assignee || !hasPermission(assignee, PERMISSIONS.SUPPORT_TICKETS_MANAGE)) {
    throw ApiError.badRequest('Tickets can only be assigned to a staff member who can manage support tickets');
  }
  ticket.assignedTo = assignee._id;
  await ticket.save();

  await notificationService.notify({
    recipient: assignee,
    type: NOTIFICATION_TYPE.SUPPORT_TICKET_ASSIGNED,
    data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber },
    eventKey: `SUPPORT_TICKET:${ticket._id}:ASSIGNED:${assignee._id}`,
  });

  return ticket;
}

async function addMessageAsAdmin(admin, ticketId, { message, attachments }) {
  const ticket = await SupportTicket.findById(ticketId);
  if (!ticket) throw ApiError.notFound('Support ticket not found');
  if (ticket.status === SUPPORT_TICKET_STATUS.CLOSED) {
    throw ApiError.badRequest('This ticket is closed. Reopen it first if it needs another reply.');
  }
  const pushed = ticket.messages[ticket.messages.push({ sender: admin._id, senderRole: admin.role, message, attachments: attachments || [] }) - 1];
  await ticket.save();

  await notificationService.notify({
    recipient: ticket.createdBy,
    type: NOTIFICATION_TYPE.SUPPORT_TICKET_REPLIED,
    data: { ticketId: ticket._id, ticketNumber: ticket.ticketNumber },
    eventKey: `SUPPORT_TICKET:${ticket._id}:REPLIED:${pushed._id}:${ticket.createdBy}`,
  });

  return ticket;
}

async function resolveForAdmin(ticketId, admin, resolution) {
  const ticket = await updateStatusForAdmin(ticketId, SUPPORT_TICKET_STATUS.RESOLVED, admin);
  ticket.resolution = resolution || null;
  await ticket.save();
  return ticket;
}

async function closeForAdmin(ticketId, admin) {
  return updateStatusForAdmin(ticketId, SUPPORT_TICKET_STATUS.CLOSED, admin);
}

module.exports = {
  createTicket,
  listForUser,
  getForUser,
  addMessageAsUser,
  closeForUser,
  listForAdmin,
  getForAdmin,
  updateStatusForAdmin,
  updatePriorityForAdmin,
  assignForAdmin,
  addMessageAsAdmin,
  resolveForAdmin,
  closeForAdmin,
};
