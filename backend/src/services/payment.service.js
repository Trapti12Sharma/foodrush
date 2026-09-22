const crypto = require('crypto');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../utils/constants');

// Abstraction boundary for payment processing — order.service.js never talks to a
// gateway SDK directly. Calls Razorpay's plain REST API directly (Basic Auth over
// HTTPS), the same style already used for Google Maps (services/geo.service.js),
// rather than adding the razorpay npm package as a dependency.
const RAZORPAY_API = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 8000;

function isOnlinePaymentConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

function isWebhookConfigured() {
  return Boolean(process.env.RAZORPAY_WEBHOOK_SECRET);
}

function authHeader() {
  return `Basic ${Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64')}`;
}

// Errors here never include the request/response body — Razorpay's own error
// messages can echo request details, and the account credentials must never reach
// a log line or a client response either way.
async function razorpayRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`${RAZORPAY_API}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(), ...(options.headers || {}) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`Razorpay request to ${path} failed:`, error.message);
    const err = new Error('The payment gateway is temporarily unavailable. Please try again.');
    err.statusCode = 502;
    throw err;
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // A non-JSON response (e.g. a gateway error page) — fall through to the generic error below.
  }

  if (!response.ok) {
    console.error(`Razorpay ${path} failed: ${body?.error?.code || `HTTP ${response.status}`}`);
    const err = new Error('The payment gateway rejected this request. Please try again, or use Cash on Delivery.');
    err.statusCode = 502;
    throw err;
  }
  return body;
}

// `amount` is in rupees; Razorpay's API takes the smallest currency unit (paise).
async function createRazorpayOrder(amount, receipt) {
  const order = await razorpayRequest('/orders', {
    method: 'POST',
    body: JSON.stringify({ amount: Math.round(amount * 100), currency: 'INR', receipt, payment_capture: 1 }),
  });
  return { razorpayOrderId: order.id, amount: order.amount, currency: order.currency };
}

// A full or partial refund of a captured payment. `amount` in rupees; omit for a full
// refund of whatever remains. Razorpay refunds are idempotent per idempotency key,
// but this app calls it at most once per Refund row, so none is sent.
async function refundRazorpayPayment({ razorpayPaymentId, amount, notes }) {
  const body = { notes };
  if (amount != null) body.amount = Math.round(amount * 100);
  const refund = await razorpayRequest(`/payments/${razorpayPaymentId}/refund`, { method: 'POST', body: JSON.stringify(body) });
  // Razorpay refunds are typically synchronous ("processed") for card/UPI/wallet in
  // test mode; a bank-transfer refund can come back "pending" and finish later via webhook.
  return { razorpayRefundId: refund.id, status: refund.status };
}

// Returns the paymentStatus + transactionId an order should be created with. For
// ONLINE this only checks that the gateway is configured — actually creating the
// Razorpay order (a network call, needing the order's amount and receipt) is done
// by order.service.js calling createRazorpayOrder directly, so it can attach the
// result to its own Order/Payment records.
async function initiatePayment({ method }) {
  if (method === PAYMENT_METHODS.COD) {
    return { paymentStatus: PAYMENT_STATUS.PENDING, transactionId: null };
  }
  if (method === PAYMENT_METHODS.ONLINE) {
    if (!isOnlinePaymentConfigured()) {
      const err = new Error(
        'Online payment is not configured on this server. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET, or choose Cash on Delivery.'
      );
      err.statusCode = 400;
      throw err;
    }
    return { paymentStatus: PAYMENT_STATUS.PENDING, transactionId: null };
  }
  const err = new Error(`Unsupported payment method: ${method}`);
  err.statusCode = 400;
  throw err;
}

// Razorpay's documented signature scheme (HMAC-SHA256 of
// "razorpayOrderId|razorpayPaymentId", keyed with the account's key secret) is pure
// local crypto, not a network call — this is what POST /orders/:id/verify-payment
// calls once the frontend's Checkout.js flow hands back a payment confirmation, to
// prove it actually came from Razorpay and wasn't forged by the client.
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
  if (!process.env.RAZORPAY_KEY_SECRET || !razorpayOrderId || !razorpayPaymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false; // signature wasn't valid hex, or the wrong length
  }
}

// Webhooks are signed over the exact raw request body (HMAC-SHA256, hex), so this
// must be called with the untouched bytes Razorpay sent — never a re-serialized
// JSON.stringify of the parsed body, which can differ byte-for-byte and fail to match.
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!process.env.RAZORPAY_WEBHOOK_SECRET || !signatureHeader) return false;

  const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHeader, 'hex'));
  } catch {
    return false;
  }
}

module.exports = {
  isOnlinePaymentConfigured,
  isWebhookConfigured,
  createRazorpayOrder,
  refundRazorpayPayment,
  initiatePayment,
  verifyPaymentSignature,
  verifyWebhookSignature,
};
