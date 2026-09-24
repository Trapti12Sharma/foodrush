const express = require('express');
const supportTicketController = require('../controllers/supportTicket.controller');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { supportLimiter } = require('../middleware/rateLimiter');
const { ROLES } = require('../utils/constants');
const {
  createTicketValidator,
  addMessageValidator,
} = require('../validators/supportTicket.validator');

const router = express.Router();

// Every party the platform actually has, per M11's spec (Part 1): customers,
// restaurant owners and delivery partners open tickets here; staff may too (Part
// 1's "ADMIN/SUPER_ADMIN where appropriate"), but only ever see tickets THEY
// personally opened through this surface — full cross-ticket management is the
// separate, permission-gated /admin/support/tickets surface (admin.routes.js).
const TICKET_ROLES = [ROLES.CUSTOMER, ROLES.RESTAURANT_OWNER, ROLES.DELIVERY_PARTNER, ROLES.ADMIN, ROLES.SUPER_ADMIN];

router.use(authenticateUser, authorizeRoles(...TICKET_ROLES));

/**
 * @swagger
 * /support/tickets:
 *   post:
 *     summary: Open a support ticket
 *     description: >
 *       `orderId`/`restaurantId` are optional and verified server-side against the caller's OWN records —
 *       a customer may only reference their own order, a restaurant owner only their own restaurant/orders,
 *       a delivery partner only a delivery they were actually assigned. An invalid relationship is rejected,
 *       never silently dropped. `createdBy`/`customer`/`deliveryPartner` are always derived from the
 *       authenticated caller, never accepted from the request body.
 *     tags: [Support]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, subject, description]
 *             properties:
 *               category: { type: string, enum: [ORDER, PAYMENT, REFUND, DELIVERY, RESTAURANT, ACCOUNT, TECHNICAL, OTHER] }
 *               subject: { type: string, maxLength: 150 }
 *               description: { type: string, maxLength: 3000 }
 *               priority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT], default: MEDIUM }
 *               orderId: { type: string }
 *               restaurantId: { type: string }
 *               attachments: { type: array, items: { type: string }, maxItems: 3, description: 'URLs from POST /uploads/image?purpose=support' }
 *     responses:
 *       201: { description: Ticket created }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: 'The referenced order/restaurant/delivery does not belong to the caller' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Too many requests }
 */
router.post('/tickets', supportLimiter, createTicketValidator, validate, supportTicketController.createTicket);

/**
 * @swagger
 * /support/tickets:
 *   get:
 *     summary: List your own support tickets
 *     tags: [Support]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [OPEN, IN_PROGRESS, WAITING_FOR_USER, RESOLVED, CLOSED] } }
 *       - { in: query, name: category, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200: { description: A page of your own tickets }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/tickets', supportTicketController.listMyTickets);

/**
 * @swagger
 * /support/tickets/{id}:
 *   get:
 *     summary: Get one of your own support tickets, with its full conversation
 *     description: 404 (never 403) if the ticket does not belong to you — this never confirms whether a ticket with that id exists at all.
 *     tags: [Support]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Ticket detail }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/tickets/:id', supportTicketController.getMyTicket);

/**
 * @swagger
 * /support/tickets/{id}/messages:
 *   post:
 *     summary: Reply to your own support ticket
 *     description: Rejected with 400 while the ticket is RESOLVED or CLOSED — ask support to reopen it first.
 *     tags: [Support]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *               attachments: { type: array, items: { type: string }, maxItems: 3 }
 *     responses:
 *       201: { description: Message added }
 *       400: { description: This ticket is not accepting new replies right now }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Too many requests }
 */
router.post('/tickets/:id/messages', supportLimiter, addMessageValidator, validate, supportTicketController.addMyMessage);

/**
 * @swagger
 * /support/tickets/{id}/close:
 *   patch:
 *     summary: Close your own support ticket
 *     tags: [Support]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Closed }
 *       400: { description: This ticket cannot be closed from its current status }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/tickets/:id/close', supportTicketController.closeMyTicket);

module.exports = router;
