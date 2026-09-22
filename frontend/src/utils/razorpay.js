// Loads Razorpay's Checkout.js on demand (not in index.html — it's only needed on the
// checkout/retry-payment flow, and self-hosting or bundling it isn't an option: it must
// come from Razorpay's own CDN for their fraud/risk checks to work).
const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';

let scriptPromise = null;
export function loadRazorpayScript() {
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.onload = () => resolve(true);
    script.onerror = () => {
      scriptPromise = null; // allow a retry later instead of caching a permanent failure
      resolve(false);
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

// Opens Razorpay's Checkout modal for a FoodRush order. `razorpay` is exactly the
// {orderId, amount, currency, keyId} object returned by order-creation / retry-payment
// (amount in rupees — Razorpay's own API wants paise, converted here). Resolves with the
// raw handler payload (razorpay_order_id/razorpay_payment_id/razorpay_signature) on
// success; rejects if the customer closes the modal or Razorpay reports the payment
// failed — callers should treat that as "offer retry", not a hard error to surface raw.
export function openRazorpayCheckout({ razorpay, order, user }) {
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: razorpay.keyId,
      amount: Math.round(razorpay.amount * 100),
      currency: razorpay.currency || 'INR',
      name: 'FoodRush',
      description: `Order ${order.orderNumber || order._id}`,
      order_id: razorpay.orderId,
      prefill: { name: user?.name, email: user?.email, contact: user?.phone },
      theme: { color: '#16a34a' },
      handler: (response) => resolve(response),
      modal: { ondismiss: () => reject(new Error('Payment window closed')) },
    });
    rzp.on('payment.failed', (response) => reject(new Error(response.error?.description || 'Payment failed')));
    rzp.open();
  });
}
