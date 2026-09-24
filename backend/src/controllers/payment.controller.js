const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const paymentService = require('../services/payment.service');
const refundService = require('../services/refund.service');
const notificationService = require('../services/notification.service');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { PAYMENT_STATUS, PAYMENT_ATTEMPT_STATUS, NOTIFICATION_TYPE } = require('../utils/constants');

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

  const order = await Order.findOneAndUpdate(
    { _id: payment.order, razorpayOrderId: entity.order_id, paymentStatus: { $ne: PAYMENT_STATUS.PAID } },
    { paymentStatus: PAYMENT_STATUS.PAID, transactionId: entity.id },
    { new: true }
  );
  if (order) {
    // Same eventKey shape as order.service.js#verifyOnlinePayment's own
    // PAYMENT_SUCCESS notification, keyed on the same razorpayPaymentId — the
    // two paths converge on one notification/email, never two, for one real payment.
    await notificationService.notify({
      recipient: order.user,
      type: NOTIFICATION_TYPE.PAYMENT_SUCCESS,
      data: { orderId: order._id, orderNumber: order.orderNumber, amount: order.totalAmount },
      eventKey: `PAYMENT:${entity.id}:SUCCESS:${order.user}`,
    });
  }
}

async function handlePaymentFailed(entity) {
  if (!entity?.order_id) return;
  const payment = await Payment.findOne({ razorpayOrderId: entity.order_id });
  if (!payment || payment.status !== PAYMENT_ATTEMPT_STATUS.CREATED) return; // already paid, or already marked failed

  payment.status = PAYMENT_ATTEMPT_STATUS.FAILED;
  payment.failureReason = entity.error_description || 'Payment failed';
  payment.confirmedVia = 'webhook';
  await payment.save();

  const order = await Order.findOneAndUpdate(
    { _id: payment.order, razorpayOrderId: entity.order_id, paymentStatus: { $ne: PAYMENT_STATUS.PAID } },
    { paymentStatus: PAYMENT_STATUS.FAILED },
    { new: true }
  );
  if (order) {
    // Deliberately PAYMENT_FAILED, not PAYMENT_RETRY_REQUIRED — the customer's
    // browser is not necessarily open for this out-of-band webhook event (see
    // order.service.js#verifyOnlinePayment for the synchronous-failure case).
    await notificationService.notify({
      recipient: order.user,
      type: NOTIFICATION_TYPE.PAYMENT_FAILED,
      data: { orderId: order._id, orderNumber: order.orderNumber },
      eventKey: `PAYMENT:${entity.id}:FAILED:${order.user}`,
    });
  }
}

module.exports = { webhook };
