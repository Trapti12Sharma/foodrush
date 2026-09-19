const express = require('express');
const orderController = require('../controllers/order.controller');
const {
  createOrderValidator,
  updateStatusValidator,
  cancelOrderValidator,
  verifyPaymentValidator,
} = require('../validators/order.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /orders:
 *   post:
 *     summary: Place an order from the signed-in customer's current cart
 *     description: >
 *       Strict and atomic, unlike the cart's browsing view: every item is
 *       re-validated fresh (fails loudly with 409 if anything changed since
 *       the cart was last viewed, rather than silently dropping it), every
 *       price/total is recomputed from the current FoodItem/Restaurant —
 *       never trusted from the cart's cached snapshot — the delivery address
 *       and item names/prices are frozen onto the order, any applied coupon
 *       is re-validated and its usage incremented, and the cart is cleared.
 *     tags: [Orders]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressId, paymentMethod]
 *             properties:
 *               addressId: { type: string, description: "Must belong to the requesting customer" }
 *               paymentMethod: { type: string, enum: [COD, ONLINE] }
 *     responses:
 *       201:
 *         description: Order placed
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } } } }
 *       400:
 *         description: Empty cart, no restaurant selected, invalid address, below minimum order, restaurant closed/unavailable, or online payment unconfigured
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409:
 *         description: An item in the cart is no longer available
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       501:
 *         description: 'paymentMethod=ONLINE is configured but the Razorpay order-creation call is not implemented'
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 */
router.post('/', createOrderValidator, validate, orderController.createOrder);

/**
 * @swagger
 * /orders:
 *   get:
 *     summary: List orders, scoped by role
 *     description: >
 *       CUSTOMER sees only their own orders (optionally further filtered by
 *       `restaurant`, e.g. for review-eligibility checks). RESTAURANT_OWNER
 *       sees orders across every restaurant they own, or one specific
 *       restaurant via `restaurant` (403 if they don't own it). ADMIN sees
 *       every order platform-wide.
 *     tags: [Orders]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, cancelled, rejected] }
 *       - in: query
 *         name: restaurant
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders: { type: array, items: { $ref: '#/components/schemas/Order' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403:
 *         description: Restaurant owner requested a restaurant they don't own
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 */
router.get('/', orderController.listOrders);

/**
 * @swagger
 * /orders/{id}:
 *   get:
 *     summary: Get one order by id
 *     description: Visible to the customer who placed it, the owner of its restaurant, or an admin — 404 for anyone else.
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The order
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', orderController.getOrder);

/**
 * @swagger
 * /orders/{id}/status:
 *   patch:
 *     summary: Advance an order's status (the restaurant that owns it, or admin)
 *     description: Only the transitions in the fixed state machine are allowed (e.g. pending→confirmed, confirmed→preparing) — any other requested status is rejected with 400.
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, cancelled, rejected] }
 *     responses:
 *       200:
 *         description: Updated order
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } } } }
 *       400: { description: 'That transition is not allowed from the order''s current status' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/:id/status',
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateStatusValidator,
  validate,
  orderController.updateStatus
);

/**
 * @swagger
 * /orders/{id}/cancel:
 *   post:
 *     summary: Cancel an order
 *     description: >
 *       The customer who placed it can cancel while pending/confirmed, but
 *       not once the restaurant starts preparing it (403 — contact the
 *       restaurant instead). The restaurant that owns it, or an admin, can
 *       still cancel through "preparing". Always rejected once the order has
 *       reached a terminal state (delivered/cancelled/rejected).
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { reason: { type: string } } }
 *     responses:
 *       200:
 *         description: Cancelled order
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } } } }
 *       400: { description: 'Order can no longer be cancelled from its current status' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: 'A customer trying to cancel after preparing has started' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/cancel', cancelOrderValidator, validate, orderController.cancelOrder);

/**
 * @swagger
 * /orders/{id}/verify-payment:
 *   post:
 *     summary: Verify a Razorpay online-payment confirmation (the customer who placed the order)
 *     description: >
 *       Pure HMAC-SHA256 signature verification against RAZORPAY_KEY_SECRET
 *       (Razorpay's documented scheme, "orderId|paymentId") — no network call,
 *       so this is fully implemented and tested independently of the
 *       (not-yet-implemented) Razorpay order-creation call. A valid signature
 *       sets paymentStatus=paid; an invalid one sets paymentStatus=failed.
 *       Idempotent once already paid.
 *     tags: [Orders]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [razorpayOrderId, razorpayPaymentId, signature]
 *             properties:
 *               razorpayOrderId: { type: string }
 *               razorpayPaymentId: { type: string }
 *               signature: { type: string }
 *     responses:
 *       200:
 *         description: Signature verified; order marked paid
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { order: { $ref: '#/components/schemas/Order' } } } } }
 *       400: { description: 'Not an online-payment order, or signature verification failed (order marked failed)' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/:id/verify-payment', verifyPaymentValidator, validate, orderController.verifyPayment);

module.exports = router;
