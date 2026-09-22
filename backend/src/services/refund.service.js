const Order = require('../models/Order');
const Payment = require('../models/Payment');
const Refund = require('../models/Refund');
const ApiError = require('../utils/ApiError');
const paymentService = require('./payment.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { ORDER_STATUS, PAYMENT_METHODS, PAYMENT_STATUS, REFUND_STATUS, REFUNDABLE_FROM_STATUSES } = require('../utils/constants');

// Initiates a refund for a paid ONLINE order — called automatically by
// order.service.js when a paid order is cancelled or rejected, and by the admin
// refund endpoint. `actor` is whoever triggered it: the customer or restaurant
// owner for an automatic refund that followed their own cancel/reject action, an
// admin for a manual one, or null only when there is truly no identifiable actor.
//
// A Razorpay failure here is recorded as a FAILED Refund row and NOT rethrown —
// the caller is very often "an order was just cancelled", and a payment-gateway
// hiccup must never undo that or block the cancellation itself. A genuinely
// invalid request (wrong order/payment state) DOES throw, since that is the
// caller's mistake, not a transient failure.
async function initiateRefund(order, { reason, actor = null, amount } = {}) {
  if (order.paymentMethod !== PAYMENT_METHODS.ONLINE) {
    throw ApiError.badRequest('Only online payments can be refunded through the payment gateway');
  }
  if (order.paymentStatus !== PAYMENT_STATUS.PAID) {
    throw ApiError.badRequest('This order has not been paid, so there is nothing to refund');
  }
  if (!REFUNDABLE_FROM_STATUSES.includes(order.orderStatus)) {
    throw ApiError.badRequest(`An order in status "${order.orderStatus}" cannot be refunded`);
  }
  if (!order.transactionId) {
    throw ApiError.badRequest('No payment reference was found for this order');
  }

  // Idempotent: a refund already in flight or completed is returned as-is, rather
  // than calling Razorpay a second time (e.g. if cancellation code runs twice).
  const existingRefund = await Refund.findOne({
    order: order._id,
    status: { $in: [REFUND_STATUS.PENDING, REFUND_STATUS.PROCESSING, REFUND_STATUS.COMPLETED] },
  });
  if (existingRefund) return existingRefund;

  const payment = await Payment.findOne({ order: order._id, razorpayPaymentId: order.transactionId });
  const refundAmount = amount ?? order.totalAmount;

  const refund = await Refund.create({
    order: order._id,
    payment: payment?._id,
    amount: refundAmount,
    reason,
    initiatedBy: actor ? actor._id : null,
    status: REFUND_STATUS.PENDING,
  });

  try {
    const result = await paymentService.refundRazorpayPayment({
      razorpayPaymentId: order.transactionId,
      amount: refundAmount,
      notes: { orderNumber: order.orderNumber, reason },
    });
    refund.razorpayRefundId = result.razorpayRefundId;
    // Razorpay refunds are typically synchronous ("processed") for card/UPI/wallet in
    // test mode; a bank-transfer refund can come back "pending" and finish later — the
    // webhook's refund.processed event (see routes/payment.routes.js) completes that case.
    refund.status = result.status === 'processed' ? REFUND_STATUS.COMPLETED : REFUND_STATUS.PROCESSING;
    await refund.save();

    order.orderStatus = refund.status === REFUND_STATUS.COMPLETED ? ORDER_STATUS.REFUNDED : ORDER_STATUS.REFUND_PENDING;
    order.paymentStatus = PAYMENT_STATUS.REFUNDED;
    order.statusHistory.push({ status: order.orderStatus, changedBy: actor ? actor._id : null });
    await order.save();
  } catch (err) {
    refund.status = REFUND_STATUS.FAILED;
    refund.failureReason = err.message;
    await refund.save();
    console.error(`Refund failed for order ${order.orderNumber}:`, err.message);
  }

  return refund;
}

// Called by the webhook when Razorpay reports a previously-pending refund has
// finished. Idempotent: re-applying the same event twice is harmless.
async function markRefundProcessed(razorpayRefundId) {
  const refund = await Refund.findOne({ razorpayRefundId });
  if (!refund || refund.status === REFUND_STATUS.COMPLETED) return;

  refund.status = REFUND_STATUS.COMPLETED;
  await refund.save();

  await Order.updateOne({ _id: refund.order, orderStatus: ORDER_STATUS.REFUND_PENDING }, { orderStatus: ORDER_STATUS.REFUNDED });
}

async function listRefunds(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.order) filter.order = query.order;

  const [items, total] = await Promise.all([
    Refund.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('order', 'orderNumber totalAmount').populate('initiatedBy', 'name email'),
    Refund.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

module.exports = { initiateRefund, markRefundProcessed, listRefunds };
