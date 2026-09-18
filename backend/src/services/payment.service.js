const { PAYMENT_METHODS, PAYMENT_STATUS } = require('../utils/constants');

// Abstraction boundary for payment processing. order.service.js calls this and
// never talks to a payment gateway SDK directly, so swapping/adding a provider
// (Razorpay, Stripe) later touches only this file.
//
// Online payments require RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env
// (see backend/.env.example). Without them, ONLINE is rejected up front rather
// than faking a successful charge — no card/payment details are ever stored by
// this app either way; a real integration would create a Razorpay order here
// and verify its signature on the client's confirmation callback.
function isOnlinePaymentConfigured() {
  return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
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
    // NOT IMPLEMENTED: real Razorpay order creation + signature verification.
    // Placeholder so the interface is exercised without pretending to charge a card.
    void amount;
    void orderRef;
    const err = new Error('Online payment integration is not yet implemented.');
    err.statusCode = 501;
    throw err;
  }

  const err = new Error(`Unsupported payment method: ${method}`);
  err.statusCode = 400;
  throw err;
}

module.exports = { initiatePayment, isOnlinePaymentConfigured };
