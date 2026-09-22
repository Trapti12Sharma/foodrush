require('./setup');
const crypto = require('crypto');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail, setupOrderable } = require('./helpers');
const Order = require('../src/models/Order');
const Payment = require('../src/models/Payment');
const paymentService = require('../src/services/payment.service');

const KEY_ID = 'rzp_test_fakekey123';
const KEY_SECRET = 'test_key_secret_XYZ';
const WEBHOOK_SECRET = 'test_webhook_secret_ABC';
const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET, webhook: process.env.RAZORPAY_WEBHOOK_SECRET };
let fetchSpy;

function useRazorpay() {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
}

beforeEach(() => {
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => {
  jest.restoreAllMocks();
  ['id', 'secret', 'webhook'].forEach((k) => {
    const env = { id: 'RAZORPAY_KEY_ID', secret: 'RAZORPAY_KEY_SECRET', webhook: 'RAZORPAY_WEBHOOK_SECRET' }[k];
    if (saved[k] === undefined) delete process.env[env];
    else process.env[env] = saved[k];
  });
});

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function orderableWithAddress(prefix) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'C', email: uniqueEmail(`${prefix}-c`), role: 'CUSTOMER' });
  const { food } = await setupOrderable(owner, { price: 200 });
  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  return { owner, customer, addressId: addr.body.data.address._id };
}

describe('online checkout creates a real Razorpay order', () => {
  it('is refused with a clear message when Razorpay is not configured', async () => {
    const { customer, addressId } = await orderableWithAddress('rp-off');
    const res = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creates the FoodRush order, a Payment attempt, and returns what Checkout.js needs', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_RZP1', amount: 21000, currency: 'INR', status: 'created' }));
    const { customer, addressId } = await orderableWithAddress('rp-ok');

    const res = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    expect(res.status).toBe(201);
    expect(res.body.data.order.razorpayOrderId).toBe('order_RZP1');
    expect(res.body.data.order.paymentStatus).toBe('pending');
    expect(res.body.data.order.orderNumber).toMatch(/^FR\d{8}$/);
    expect(res.body.data.razorpay).toEqual({ orderId: 'order_RZP1', amount: res.body.data.order.totalAmount, currency: 'INR', keyId: KEY_ID });
    expect(JSON.stringify(res.body)).not.toContain(KEY_SECRET);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
    const sentBody = JSON.parse(options.body);
    expect(sentBody).toMatchObject({ amount: Math.round(res.body.data.order.totalAmount * 100), currency: 'INR', receipt: res.body.data.order.orderNumber, payment_capture: 1 });

    const payment = await Payment.findOne({ order: res.body.data.order._id });
    expect(payment).toMatchObject({ razorpayOrderId: 'order_RZP1', amount: res.body.data.order.totalAmount, status: 'CREATED' });
  });

  it('creates nothing (no order, no claimed coupon) when Razorpay rejects the request', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(401, { error: { code: 'BAD_REQUEST_ERROR', description: `bad key ${KEY_SECRET}` } }));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { customer, addressId } = await orderableWithAddress('rp-fail');

    const res = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(KEY_SECRET);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(KEY_SECRET);
    expect(await Order.countDocuments({})).toBe(0);
    expect(await Payment.countDocuments({})).toBe(0);
    errSpy.mockRestore();
  });

  it('never charges the amount the client asks for — it recomputes the total server-side', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_RZPX', amount: 1, currency: 'INR' }));
    const { customer, addressId } = await orderableWithAddress('rp-amt');

    // A tampered/irrelevant amount in the request body is simply not a field this endpoint reads.
    const res = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE', amount: 1 });
    expect(res.status).toBe(201);
    const sentBody = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(sentBody.amount).toBe(Math.round(res.body.data.order.totalAmount * 100));
    expect(sentBody.amount).not.toBe(1);
  });
});

describe('POST /orders/:id/retry-payment', () => {
  async function unpaidOnlineOrder(prefix) {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_FIRST', amount: 21000, currency: 'INR' }));
    const { customer, addressId } = await orderableWithAddress(prefix);
    const res = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    return { customer, orderId: res.body.data.order._id };
  }

  it('creates a fresh Razorpay order and Payment row without re-touching the cart', async () => {
    const { customer, orderId } = await unpaidOnlineOrder('retry-ok');
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_SECOND', amount: 21000, currency: 'INR' }));

    const res = await customer.post(`/api/orders/${orderId}/retry-payment`);
    expect(res.status).toBe(200);
    expect(res.body.data.order.razorpayOrderId).toBe('order_SECOND');
    expect(res.body.data.razorpay.orderId).toBe('order_SECOND');
    expect(await Payment.countDocuments({ order: orderId })).toBe(2);
    expect(await Payment.countDocuments({ order: orderId, razorpayOrderId: 'order_SECOND' })).toBe(1);
  });

  it('is refused for a COD order, an already-paid order, someone else\'s order, or an order past the point of paying', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('retry-cod-o'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    const codCustomer = await registerAndLogin({ name: 'C', email: uniqueEmail('retry-cod-c'), role: 'CUSTOMER' });
    const addr = await codCustomer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await codCustomer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const codOrder = await codCustomer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect((await codCustomer.post(`/api/orders/${codOrder.body.data.order._id}/retry-payment`)).status).toBe(400);

    const { customer, orderId } = await unpaidOnlineOrder('retry-bad');
    const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('retry-stranger'), role: 'CUSTOMER' });
    expect((await stranger.post(`/api/orders/${orderId}/retry-payment`)).status).toBe(403);

    await Order.findByIdAndUpdate(orderId, { orderStatus: 'CANCELLED' });
    expect((await customer.post(`/api/orders/${orderId}/retry-payment`)).status).toBe(400);
  });
});

describe('POST /orders/:id/verify-payment ties the signature to the order\'s current attempt', () => {
  const sign = (orderId, paymentId, secret) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

  it('rejects a valid signature for a DIFFERENT razorpayOrderId than the one on the order', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_REAL', amount: 21000, currency: 'INR' }));
    const { customer, addressId } = await orderableWithAddress('verify-mismatch');
    const created = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    const orderId = created.body.data.order._id;

    // A signature that is cryptographically valid, but for a razorpayOrderId this order was never given.
    const foreignOrderId = 'order_SOMEONE_ELSES';
    const paymentId = 'pay_1';
    const res = await customer.post(`/api/orders/${orderId}/verify-payment`).send({
      razorpayOrderId: foreignOrderId, razorpayPaymentId: paymentId, signature: sign(foreignOrderId, paymentId, KEY_SECRET),
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/does not match/i);
    expect((await Order.findById(orderId)).paymentStatus).toBe('pending');
  });

  it('marks the matching Payment row paid on success, and failed on a bad signature', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_REAL2', amount: 21000, currency: 'INR' }));
    const { customer, addressId } = await orderableWithAddress('verify-ok');
    const created = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    const orderId = created.body.data.order._id;
    const razorpayOrderId = created.body.data.razorpay.orderId;

    const bad = await customer.post(`/api/orders/${orderId}/verify-payment`).send({ razorpayOrderId, razorpayPaymentId: 'pay_x', signature: 'f'.repeat(64) });
    expect(bad.status).toBe(400);
    expect((await Payment.findOne({ order: orderId })).status).toBe('FAILED');

    // Retrying creates a NEW attempt; verifying against the new one still works.
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_REAL3', amount: 21000, currency: 'INR' }));
    const retried = await customer.post(`/api/orders/${orderId}/retry-payment`);
    const newRazorpayOrderId = retried.body.data.razorpay.orderId;
    const paymentId = 'pay_good';
    const good = await customer.post(`/api/orders/${orderId}/verify-payment`).send({
      razorpayOrderId: newRazorpayOrderId, razorpayPaymentId: paymentId, signature: sign(newRazorpayOrderId, paymentId, KEY_SECRET),
    });
    expect(good.status).toBe(200);
    expect(good.body.data.order.paymentStatus).toBe('paid');
    const paidPayment = await Payment.findOne({ order: orderId, razorpayOrderId: newRazorpayOrderId });
    expect(paidPayment).toMatchObject({ status: 'PAID', razorpayPaymentId: paymentId, confirmedVia: 'verify_endpoint' });
  });
});

describe('POST /api/payments/webhook', () => {
  // Sent as a STRING, not a Buffer: supertest/superagent re-serializes a Buffer given
  // to .send() with a json content-type (as {type:'Buffer',data:[...]}), which would
  // corrupt the exact bytes the signature was computed over. A string round-trips
  // byte-for-byte through express.raw() instead (verified directly against this app
  // before writing these tests).
  const sendWebhook = (payload, secret = WEBHOOK_SECRET) => {
    const raw = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex');
    return request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(raw);
  };

  it('rejects a missing or wrong signature without acting on the event', async () => {
    useRazorpay();
    const noSig = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').send('{}');
    expect(noSig.status).toBe(400);
    const wrongSig = await sendWebhook({ event: 'payment.captured' }, 'wrong-secret');
    expect(wrongSig.status).toBe(400);
  });

  it('is a 400 (webhook not usable) when RAZORPAY_WEBHOOK_SECRET is not configured', async () => {
    // KEY_ID/SECRET set, but webhook secret deliberately absent.
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    const res = await sendWebhook({ event: 'payment.captured' });
    expect(res.status).toBe(400);
  });

  it('marks the Payment and Order paid on payment.captured, idempotently', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_WH1', amount: 21000, currency: 'INR' }));
    const { customer, addressId } = await orderableWithAddress('wh-captured');
    const created = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    const orderId = created.body.data.order._id;

    const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay_wh1', order_id: 'order_WH1', status: 'captured' } } } };
    const res = await sendWebhook(event);
    expect(res.status).toBe(200);
    expect((await Order.findById(orderId)).paymentStatus).toBe('paid');
    expect((await Order.findById(orderId)).transactionId).toBe('pay_wh1');
    expect((await Payment.findOne({ order: orderId })).confirmedVia).toBe('webhook');

    // A second, identical webhook delivery (Razorpay retries) changes nothing further.
    await sendWebhook(event);
    expect(await Payment.countDocuments({ order: orderId, status: 'PAID' })).toBe(1);
  });

  it('does not let a webhook UN-pay an order the browser already confirmed as paid', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_WH2', amount: 21000, currency: 'INR' }));
    const { customer, addressId } = await orderableWithAddress('wh-already-paid');
    const created = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    const orderId = created.body.data.order._id;
    const razorpayOrderId = created.body.data.razorpay.orderId;
    const paymentId = 'pay_browser';
    await customer.post(`/api/orders/${orderId}/verify-payment`).send({
      razorpayOrderId, razorpayPaymentId: paymentId, signature: sign(razorpayOrderId, paymentId, KEY_SECRET),
    });

    await sendWebhook({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_browser', order_id: razorpayOrderId, status: 'captured' } } } });
    expect((await Order.findById(orderId)).paymentStatus).toBe('paid');
    expect((await Order.findById(orderId)).transactionId).toBe('pay_browser');
  });

  it('marks payment.failed only while an attempt is still CREATED, and ignores unknown event types', async () => {
    useRazorpay();
    fetchSpy.mockResolvedValue(reply(200, { id: 'order_WH3', amount: 21000, currency: 'INR' }));
    const { customer, addressId } = await orderableWithAddress('wh-failed');
    const created = await customer.post('/api/orders').send({ addressId, paymentMethod: 'ONLINE' });
    const orderId = created.body.data.order._id;

    const res = await sendWebhook({ event: 'payment.failed', payload: { payment: { entity: { order_id: 'order_WH3', error_description: 'insufficient funds' } } } });
    expect(res.status).toBe(200);
    expect((await Order.findById(orderId)).paymentStatus).toBe('failed');
    expect((await Payment.findOne({ order: orderId })).failureReason).toBe('insufficient funds');

    const ignored = await sendWebhook({ event: 'order.paid', payload: {} });
    expect(ignored.status).toBe(200);
  });

  function sign(orderId, paymentId, secret) {
    return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  }
});
