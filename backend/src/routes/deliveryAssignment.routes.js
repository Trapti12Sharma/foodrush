const express = require('express');
const { body } = require('express-validator');
const deliveryAssignmentController = require('../controllers/deliveryAssignment.controller');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticateUser, authorizeRoles(ROLES.DELIVERY_PARTNER));

/**
 * @swagger
 * /delivery-assignments/me/offers:
 *   get:
 *     summary: Your current pending delivery offers (DELIVERY_PARTNER role only)
 *     description: Only OFFERED, not-yet-expired offers — an offer past its expiresAt is lazily flipped to EXPIRED and excluded here rather than relying on a background timer.
 *     tags: [Delivery Assignments]
 *     responses:
 *       200: { description: Pending offers }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: No delivery partner profile yet }
 */
router.get('/me/offers', deliveryAssignmentController.myOffers);

/**
 * @swagger
 * /delivery-assignments/me/current:
 *   get:
 *     summary: Your current active delivery (an ASSIGNED assignment), if any
 *     tags: [Delivery Assignments]
 *     responses:
 *       200: { description: 'Current delivery, or { assignment: null }' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: No delivery partner profile yet }
 */
router.get('/me/current', deliveryAssignmentController.myCurrentDelivery);

/**
 * @swagger
 * /delivery-assignments/me:
 *   get:
 *     summary: Your full assignment history (paginated)
 *     tags: [Delivery Assignments]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [OFFERED, ACCEPTED, ASSIGNED, REJECTED, EXPIRED, CANCELLED, COMPLETED] } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200: { description: A page of your assignments }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: No delivery partner profile yet }
 */
router.get('/me', deliveryAssignmentController.myAssignments);

/**
 * @swagger
 * /delivery-assignments/{id}/accept:
 *   patch:
 *     summary: Accept an offered delivery
 *     description: >
 *       Re-checks ACTIVE+VERIFIED+ONLINE fresh at the moment of accepting, not just when the offer was created.
 *       Atomic against a second, concurrent accept for the same order — see deliveryAssignment.service.js.
 *       On success, links the order to you and moves it READY_FOR_PICKUP -> OUT_FOR_DELIVERY.
 *     tags: [Delivery Assignments]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Accepted }
 *       400: { description: 'Expired, already responded to, or you are no longer eligible (not active/verified/online)' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: This offer does not belong to you }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: The order was just assigned to another delivery partner (lost the race) }
 */
router.patch('/:id/accept', deliveryAssignmentController.accept);

/**
 * @swagger
 * /delivery-assignments/{id}/reject:
 *   patch:
 *     summary: Reject an offered delivery
 *     description: Immediately attempts to offer the order to the next eligible rider (best-effort — never fails this request if nobody else is available).
 *     tags: [Delivery Assignments]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: Rejected }
 *       400: { description: No longer an open offer to respond to }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: This offer does not belong to you }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/:id/reject', [body('reason').optional({ checkFalsy: true }).trim().isLength({ max: 300 })], validate, deliveryAssignmentController.reject);

module.exports = router;
