const crypto = require('crypto');
const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../utils/constants');

// Abstraction boundary for payment processing. order.service.js calls this and
// never talks to a payment gateway SDK directly, so swapping/adding a provider
// (Razorpay, Stripe) later touches only this file.
//
// Online payments require RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env
// (see backend/.env.example). Without them, ONLINE is rejected up front rather
// than faking a successful charge — no card/payment details are ever stored by
// this app either way.
function isOnlinePaymentConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}

// NOT IMPLEMENTED: this would call the Razorpay SDK to open a payment session
// for this amount — a real network call to Razorpay's API, which cannot be
// exercised or verified without a live account. Never tested in this
// environment. To implement:
//   npm install razorpay
//   const instance = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
//   const rzpOrder = await instance.orders.create({ amount: Math.round(amount * 100), currency: 'INR', receipt });
//   return { razorpayOrderId: rzpOrder.id };
// then have the frontend open Razorpay's Checkout.js with that order id, and
// send the resulting payment id + signature to POST /api/orders/:id/verify-payment.
async function createRazorpayOrder(amount, receipt) {
  void amount;
  void receipt;
  const err = new Error('Razorpay order creation is not implemented in this deployment.');
  err.statusCode = 501;
  throw err;
}

// Returns the paymentStatus + transactionId an order should be created with.
// Throws if the requested method can't actually be fulfilled right now.
async function initiatePayment({ method, amount, orderRef }) {
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
    await createRazorpayOrder(amount, orderRef); // always throws 501 today — see above
    return { paymentStatus: PAYMENT_STATUS.PENDING, transactionId: null };
  }

  const err = new Error(`Unsupported payment method: ${method}`);
  err.statusCode = 400;
  throw err;
}

// UNLIKE createRazorpayOrder above, this IS fully implemented and tested —
// Razorpay's documented signature scheme (HMAC-SHA256 of
// "razorpayOrderId|razorpayPaymentId", keyed with the account's key secret)
// is pure local crypto, not a network call, so it doesn't need a live account
// to verify correct. This is what POST /api/orders/:id/verify-payment calls
// once the frontend's Razorpay Checkout.js flow hands back a payment
// confirmation, to prove that confirmation actually came from Razorpay and
// wasn't forged by the client.
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, signature }) {
  if (!process.env.RAZORPAY_KEY_SECRET || !razorpayOrderId || !razorpayPaymentId || !signature) return false;

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  try {
    // Constant-time comparison — a naive === would leak timing information
    // about how many leading bytes of the signature matched.
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false; // signature wasn't valid hex, or the wrong length
  }
}

module.exports = { initiatePayment, isOnlinePaymentConfigured, verifyPaymentSignature };
