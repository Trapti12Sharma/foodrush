const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const auditService = require('../services/audit.service');
const supportTicketService = require('../services/supportTicket.service');

// Every handler here is scoped to req.user's OWN tickets (createdBy === req.user._id)
// — see supportTicket.service.js. Available to CUSTOMER, RESTAURANT_OWNER,
// DELIVERY_PARTNER, and staff (who see only tickets they personally opened here;
// full cross-ticket management is the separate /admin/support/tickets surface).
const createTicket = asyncHandler(async (req, res) => {
  const ticket = await supportTicketService.createTicket(req.user, req.body);
  await auditService.record({
    req,
    action: 'support_ticket.create',
    entityType: 'SupportTicket',
    entityId: ticket._id,
    metadata: { ticketNumber: ticket.ticketNumber, category: ticket.category, priority: ticket.priority },
  });
  res.status(201).json(new ApiResponse(201, 'Support ticket created', { ticket }));
});

const listMyTickets = asyncHandler(async (req, res) => {
  const { items, pagination } = await supportTicketService.listForUser(req.user, req.query);
  res.json(new ApiResponse(200, 'Your support tickets', { tickets: items, pagination }));
});

const getMyTicket = asyncHandler(async (req, res) => {
  const ticket = await supportTicketService.getForUser(req.user, req.params.id);
  res.json(new ApiResponse(200, 'Support ticket fetched', { ticket }));
});

const addMyMessage = asyncHandler(async (req, res) => {
  const ticket = await supportTicketService.addMessageAsUser(req.user, req.params.id, req.body);
  res.status(201).json(new ApiResponse(201, 'Message added', { ticket }));
});

const closeMyTicket = asyncHandler(async (req, res) => {
  const ticket = await supportTicketService.closeForUser(req.user, req.params.id);
  await auditService.record({ req, action: 'support_ticket.close', entityType: 'SupportTicket', entityId: ticket._id, metadata: { ticketNumber: ticket.ticketNumber } });
  res.json(new ApiResponse(200, 'Support ticket closed', { ticket }));
});

module.exports = { createTicket, listMyTickets, getMyTicket, addMyMessage, closeMyTicket };
