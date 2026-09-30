const express = require('express');
const paymentController = require('../controllers/payment.controller');

const router = express.Router();

/**
 * @swagger
 * /payments/webhook:
 *   post:
 *     summary: Razorpay webhook (payment.captured, payment.failed, refund.processed)
 *     description: >
 *       Confirms payments and refunds independently of the customer's browser — the safety net behind
 *       POST /orders/:id/verify-payment for a customer who closes the tab right after paying. Verifies
 *       the `X-Razorpay-Signature` header (HMAC-SHA256 over the raw request body, keyed with
 *       RAZORPAY_WEBHOOK_SECRET) before touching anything; an invalid signature is rejected with 400 and
 *       has no effect. Configure this exact URL in the Razorpay dashboard's webhook settings.
 *     tags: [Payments]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, description: 'Razorpay event payload — see Razorpay webhook docs' }
 *     responses:
 *       200: { description: Received (including for an event type this app ignores) }
 *       400: { description: Invalid signature or payload }
 */
router.post('/webhook', paymentController.webhook);

module.exports = router;
