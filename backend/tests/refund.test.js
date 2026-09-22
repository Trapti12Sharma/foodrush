require('./setup');
const crypto = require('crypto');
const { registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const Order = require('../src/models/Order');
const Refund = require('../src/models/Refund');
const Payment = require('../src/models/Payment');

const KEY_ID = 'rzp_test_fakekey123';
const KEY_SECRET = 'test_key_secret_XYZ';
const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
let fetchSpy;

beforeEach(() => {
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => {
  jest.restoreAllMocks();
  if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = saved.id;
  if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = saved.secret;
});

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const sign = (orderId, paymentId, secret) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

// Places and fully pays for an ONLINE order (Razorpay order creation + verify-payment,
// both mocked), returning it ready to be cancelled/rejected/refunded.
async function paidOnlineOrder(prefix, { price = 200 } = {}) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'C', email: uniqueEmail(`${prefix}-c`), role: 'CUSTOMER' });
  const { restaurant, food } = await setupOrderable(owner, { price });
  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });

  fetchSpy.mockResolvedValueOnce(reply(200, { id: `order_${prefix}`, amount: 1, currency: 'INR' }));
  const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'ONLINE' });
  const orderId = created.body.data.order._id;
  const razorpayOrderId = created.body.data.razorpay.orderId;
  const paymentId = `pay_${prefix}`;
  await customer.post(`/api/orders/${orderId}/verify-payment`).send({
    razorpayOrderId, razorpayPaymentId: paymentId, signature: sign(razorpayOrderId, paymentId, KEY_SECRET),
  });

  return { owner, customer, orderId, restaurant, totalAmount: created.body.data.order.totalAmount };
}

describe('automatic refund on cancellation / rejection', () => {
  it('refunds a paid order when the customer cancels it, and marks the order REFUNDED', async () => {
    const { customer, orderId, totalAmount } = await paidOnlineOrder('auto-cancel');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_1', amount: totalAmount * 100, status: 'processed' }));

    const res = await customer.post(`/api/orders/${orderId}/cancel`);
    expect(res.status).toBe(200);
    expect(res.body.data.order.orderStatus).toBe('REFUNDED'); // Razorpay's mock reply said "processed" -> immediately complete
    expect(res.body.data.order.paymentStatus).toBe('refunded');

    const refund = await Refund.findOne({ order: orderId });
    expect(refund).toMatchObject({ amount: totalAmount, reason: 'customer_cancellation', status: 'COMPLETED', razorpayRefundId: 'rfnd_1' });
    // Automatic, but the acting customer is still recorded — useful for support, and
    // distinguishable from a staff-initiated refund by role (customer vs. admin), not by being null.
    expect(refund.initiatedBy).toBeTruthy();

    const [url, options] = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
    expect(url).toBe(`https://api.razorpay.com/v1/payments/pay_auto-cancel/refund`);
    expect(JSON.parse(options.body).amount).toBe(Math.round(totalAmount * 100));
  });

  it('refunds a paid order when the restaurant rejects it, with reason restaurant_rejection', async () => {
    const { owner, orderId, totalAmount } = await paidOnlineOrder('auto-reject');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_2', amount: totalAmount * 100, status: 'processed' }));

    const res = await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'REJECTED' });
    expect(res.status).toBe(200);
    expect(res.body.data.order.orderStatus).toBe('REFUNDED');
    expect((await Refund.findOne({ order: orderId })).reason).toBe('restaurant_rejection');
  });

  it('leaves a pending-processing refund as REFUND_PENDING until the webhook confirms it', async () => {
    const { customer, orderId } = await paidOnlineOrder('auto-pending');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_3', status: 'pending' })); // e.g. a bank-transfer refund

    const res = await customer.post(`/api/orders/${orderId}/cancel`);
    expect(res.body.data.order.orderStatus).toBe('REFUND_PENDING');
    expect((await Refund.findOne({ order: orderId })).status).toBe('PROCESSING');
  });

  it('does NOT refund a COD order, and does not block the cancellation when the gateway refund call fails', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('auto-cod-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('auto-cod-c'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const codOrder = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const cancelled = await customer.post(`/api/orders/${codOrder.body.data.order._id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.orderStatus).toBe('CANCELLED'); // NOT bumped to a refund state
    expect(await Refund.countDocuments({})).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();

    const { customer: onlineCustomer, orderId } = await paidOnlineOrder('auto-gwfail');
    fetchSpy.mockResolvedValueOnce(reply(502, { error: { description: 'gateway down' } }));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await onlineCustomer.post(`/api/orders/${orderId}/cancel`);
    expect(res.status).toBe(200); // the cancellation itself still succeeds
    expect(res.body.data.order.orderStatus).toBe('CANCELLED'); // refund failed, so it was NOT bumped to REFUNDED
    expect((await Refund.findOne({ order: orderId })).status).toBe('FAILED');
    errSpy.mockRestore();
  });

  it('is idempotent — cancelling twice does not call the gateway twice', async () => {
    const { customer, orderId } = await paidOnlineOrder('auto-idem');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_4', status: 'processed' }));
    await customer.post(`/api/orders/${orderId}/cancel`);
    // The order is now REFUNDED (terminal) — cancel again is rejected by the status
    // machine itself before refund logic would even run a second time.
    const second = await customer.post(`/api/orders/${orderId}/cancel`);
    expect(second.status).toBe(400);
    expect(await Refund.countDocuments({ order: orderId })).toBe(1);
  });
});

describe('POST /admin/orders/:id/refund (manual)', () => {
  it('requires the refunds:manage permission', async () => {
    const request = require('supertest');
    const { app } = require('./helpers');
    const { orderId } = await paidOnlineOrder('manual-perm');
    expect((await request(app).post(`/api/admin/orders/${orderId}/refund`)).status).toBe(401);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('manual-perm-c'), role: 'CUSTOMER' });
    expect((await customer.post(`/api/admin/orders/${orderId}/refund`)).status).toBe(403);
    const { agent: support } = await createUserWithRole('SUPPORT_AGENT');
    expect((await support.post(`/api/admin/orders/${orderId}/refund`)).status).toBe(403);
  });

  it('lets an admin refund a delivered order, records who did it, and audits it', async () => {
    const { orderId } = await paidOnlineOrder('manual-ok');
    await Order.findByIdAndUpdate(orderId, {
      orderStatus: 'DELIVERED',
      $push: { statusHistory: { status: 'DELIVERED' } },
    });
    const { agent: admin, user: adminUser } = await createUserWithRole('ADMIN');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_manual', status: 'processed' }));

    const res = await admin.post(`/api/admin/orders/${orderId}/refund`).send({ reason: 'operational_issue' });
    expect(res.status).toBe(200);
    expect(res.body.data.refund).toMatchObject({ status: 'COMPLETED', reason: 'operational_issue' });
    const refund = await Refund.findById(res.body.data.refund._id);
    expect(refund.initiatedBy.toString()).toBe(adminUser._id.toString());
    expect((await Order.findById(orderId)).orderStatus).toBe('REFUNDED');

    const AuditLog = require('../src/models/AuditLog');
    expect(await AuditLog.countDocuments({ action: 'order.refund', entityId: orderId })).toBe(1);
  });

  it('supports a partial refund amount', async () => {
    const { orderId, totalAmount } = await paidOnlineOrder('manual-partial');
    await Order.findByIdAndUpdate(orderId, { orderStatus: 'DELIVERED' });
    const { agent: admin } = await createUserWithRole('ADMIN');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_partial', status: 'processed' }));

    const partialAmount = Math.round(totalAmount / 2);
    await admin.post(`/api/admin/orders/${orderId}/refund`).send({ amount: partialAmount });
    const sentBody = JSON.parse(fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1][1].body);
    expect(sentBody.amount).toBe(Math.round(partialAmount * 100));
  });

  it('rejects refunding an order that was never paid online, or one still in progress', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('manual-cod-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant, food } = await setupOrderable(owner);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('manual-cod-c'), role: 'CUSTOMER' });
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const codOrder = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const { agent: admin } = await createUserWithRole('ADMIN');
    expect((await admin.post(`/api/admin/orders/${codOrder.body.data.order._id}/refund`)).status).toBe(400);

    const { orderId } = await paidOnlineOrder('manual-inprogress');
    // Still PLACED/paid — not yet cancelled/rejected/delivered.
    expect((await admin.post(`/api/admin/orders/${orderId}/refund`)).status).toBe(400);
    void restaurant;
  });

  it('validates the request body', async () => {
    const { orderId } = await paidOnlineOrder('manual-validate');
    const { agent: admin } = await createUserWithRole('ADMIN');
    expect((await admin.post(`/api/admin/orders/${orderId}/refund`).send({ amount: -5 })).status).toBe(422);
    expect((await admin.post(`/api/admin/orders/${orderId}/refund`).send({ reason: 'not_a_real_reason' })).status).toBe(422);
  });
});

describe('GET /admin/refunds', () => {
  it('lists refunds, filterable by status, for staff with the refunds:manage permission', async () => {
    const { orderId: a } = await paidOnlineOrder('list-a');
    const { orderId: b } = await paidOnlineOrder('list-b');
    await Order.findByIdAndUpdate(a, { orderStatus: 'DELIVERED' });
    await Order.findByIdAndUpdate(b, { orderStatus: 'DELIVERED' });
    const { agent: admin } = await createUserWithRole('ADMIN');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_a', status: 'processed' }));
    fetchSpy.mockResolvedValueOnce(reply(502, {}));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await admin.post(`/api/admin/orders/${a}/refund`);
    await admin.post(`/api/admin/orders/${b}/refund`).catch(() => {});
    errSpy.mockRestore();

    const all = await admin.get('/api/admin/refunds');
    expect(all.body.data.pagination.total).toBeGreaterThanOrEqual(2);
    const failedOnly = await admin.get('/api/admin/refunds?status=FAILED');
    expect(failedOnly.body.data.refunds.every((r) => r.status === 'FAILED')).toBe(true);

    const { agent: support } = await createUserWithRole('SUPPORT_AGENT');
    expect((await support.get('/api/admin/refunds')).status).toBe(403);
  });
});

describe('refund.processed webhook completes a PROCESSING refund', () => {
  it('moves REFUND_PENDING -> REFUNDED once Razorpay confirms it', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 'wh_secret_refund_test';
    const { customer, orderId } = await paidOnlineOrder('webhook-refund');
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_webhook', status: 'pending' }));
    await customer.post(`/api/orders/${orderId}/cancel`);
    expect((await Order.findById(orderId)).orderStatus).toBe('REFUND_PENDING');

    const request = require('supertest');
    const { app } = require('./helpers');
    const payload = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_webhook', status: 'processed' } } } });
    const signature = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(Buffer.from(payload)).digest('hex');
    const res = await request(app).post('/api/payments/webhook').set('Content-Type', 'application/json').set('X-Razorpay-Signature', signature).send(payload);

    expect(res.status).toBe(200);
    expect((await Order.findById(orderId)).orderStatus).toBe('REFUNDED');
    expect((await Refund.findOne({ order: orderId })).status).toBe('COMPLETED');
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
  });
});

describe('the order response references Payment by id only, never a populated document', () => {
  it('GET /orders/:id returns latestPayment as a plain id', async () => {
    const { customer, orderId } = await paidOnlineOrder('no-leak');
    const res = await customer.get(`/api/orders/${orderId}`);
    expect(typeof res.body.data.order.latestPayment).toBe('string');
  });
});
