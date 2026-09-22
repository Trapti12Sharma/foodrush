const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const paymentService = require('../services/payment.service');
const refundService = require('../services/refund.service');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { PAYMENT_STATUS, PAYMENT_ATTEMPT_STATUS } = require('../utils/constants');

// Razorpay POSTs events here independently of whether the customer's browser ever
// called POST /orders/:id/verify-payment (e.g. they closed the tab right after
// paying) — this is the safety net behind that synchronous flow, not a replacement
// for it. `req.body` is a raw Buffer here: app.js mounts express.raw() on this exact
// path, ahead of the app's normal express.json(), because the signature is computed
// over the EXACT bytes Razorpay sent — a re-serialized JSON.stringify of a parsed
// body is not guaranteed to match byte-for-byte and would fail verification.
const webhook = asyncHandler(async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  if (!Buffer.isBuffer(req.body) || !paymentService.verifyWebhookSignature(req.body, signature)) {
    return res.status(400).json(new ApiResponse(400, 'Invalid webhook signature'));
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json(new ApiResponse(400, 'Invalid payload'));
  }

  switch (event.event) {
    case 'payment.captured':
      await handlePaymentCaptured(event.payload?.payment?.entity);
      break;
    case 'payment.failed':
      await handlePaymentFailed(event.payload?.payment?.entity);
      break;
    case 'refund.processed':
      if (event.payload?.refund?.entity?.id) await refundService.markRefundProcessed(event.payload.refund.entity.id);
      break;
    default:
      break; // every other event type is deliberately ignored
  }

  // Always 200 once the signature checks out, even for an event we ignored —
  // anything else makes Razorpay retry a webhook that was never going to be acted on.
  return res.status(200).json(new ApiResponse(200, 'Webhook received'));
});

async function handlePaymentCaptured(entity) {
  if (!entity?.order_id) return;
  const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
  if (!payment || payment.status === PAYMENT_ATTEMPT_STATUS.PAID) return; // unknown attempt, or already handled (e.g. by verify-payment)

  payment.status = PAYMENT_ATTEMPT_STATUS.PAID;
  payment.razorpayPaymentId = entity.id;
  payment.confirmedVia = 'webhook';
  await payment.save();

  await Order.updateOne(
    { _id: payment.order, razorpayOrderId: entity.order_id, paymentStatus: { $ne: PAYMENT_STATUS.PAID } },
    { paymentStatus: PAYMENT_STATUS.PAID, transactionId: entity.id }
  );
}

async function handlePaymentFailed(entity) {
  if (!entity?.order_id) return;
  const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
  if (!payment || payment.status !== PAYMENT_ATTEMPT_STATUS.CREATED) return; // already paid, or already marked failed

  payment.status = PAYMENT_ATTEMPT_STATUS.FAILED;
  payment.failureReason = entity.error_description || 'Payment failed';
  payment.confirmedVia = 'webhook';
  await payment.save();

  await Order.updateOne(
    { _id: payment.order, razorpayOrderId: entity.order_id, paymentStatus: { $ne: PAYMENT_STATUS.PAID } },
    { paymentStatus: PAYMENT_STATUS.FAILED }
  );
}

module.exports = { webhook };
