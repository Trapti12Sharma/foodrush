const express = require('express');
const { query, param } = require('express-validator');
const deliveryEarningController = require('../controllers/deliveryEarning.controller');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES, DELIVERY_EARNING_STATUS } = require('../utils/constants');

// Mounted at the SAME /delivery-partners prefix as deliveryPartner.routes.js
// (routes/index.js) — a separate router file purely because this is its own
// concern/service (M10), exactly like deliveryAssignment.routes.js is already
// its own file despite also being rider self-service.
const router = express.Router();

router.use(authenticateUser, authorizeRoles(ROLES.DELIVERY_PARTNER));

/**
 * @swagger
 * /delivery-partners/me/earnings:
 *   get:
 *     summary: Your delivery earnings, paginated, with all-time summary totals (DELIVERY_PARTNER role only)
 *     description: >
 *       `summary` is always your all-time totals regardless of the filters below (a wallet-style
 *       balance), while `items`/`pagination` reflect whatever filter was applied. A rider only ever
 *       sees their own earnings — there is no way to query another rider's.
 *     tags: [Delivery Earnings]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, SETTLED] } }
 *       - { in: query, name: from, schema: { type: string, format: date }, description: earnedAt >= this date }
 *       - { in: query, name: to, schema: { type: string, format: date }, description: earnedAt <= this date }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200:
 *         description: A page of earnings plus summary totals
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     items: { type: array, items: { $ref: '#/components/schemas/DeliveryEarning' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *                     summary:
 *                       type: object
 *                       properties:
 *                         totalEarned: { type: number }
 *                         pendingSettlement: { type: number }
 *                         settledAmount: { type: number }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { description: No delivery partner profile yet }
 */
router.get(
  '/me/earnings',
  [
    query('status').optional().isIn(Object.values(DELIVERY_EARNING_STATUS)),
    query('from').optional().isISO8601(),
    query('to').optional().isISO8601(),
  ],
  validate,
  deliveryEarningController.myEarnings
);

/**
 * @swagger
 * /delivery-partners/me/earnings/{id}:
 *   get:
 *     summary: One of your earnings, with its full breakdown (DELIVERY_PARTNER role only)
 *     description: Must belong to the authenticated rider — an earning that exists but belongs to someone else gets an identical 404, never a 403.
 *     tags: [Delivery Earnings]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Earning detail }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/me/earnings/:id', [param('id').isMongoId()], validate, deliveryEarningController.myEarningById);

module.exports = router;
