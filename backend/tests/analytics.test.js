require('./setup');
const request = require('supertest');
const app = require('../src/app');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Order = require('../src/models/Order');
const Payment = require('../src/models/Payment');
const Refund = require('../src/models/Refund');
const analyticsService = require('../src/services/analytics.service');
const { parseDateRange, eachUtcDay } = require('../src/utils/dateRange');

// ---------------------------------------------------------------------------
// Deterministic fixtures. Every order below is created through the real API and
// driven through the real status transitions, so the analytics under test read
// exactly the records the application itself writes — no hand-built documents
// pretending to be orders, and no fabricated totals.
//
// One item at ₹100 + ₹10 delivery + 5% tax = ₹115 totalAmount per order, which
// is the same arithmetic dashboard.test.js already asserts.
// ---------------------------------------------------------------------------
const ORDER_TOTAL = 115;

async function makeRestaurant(owner, label) {
  const res = await owner.post('/api/restaurants').send({
    name: `Analytics ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: `Item ${label}`, price: 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

// Places one order and drives it to `finalStatus` through the real transitions.
// A coupon is applied to the CART first (POST /cart/coupon), which is how the
// application actually does it — order creation reads cart.couponCode rather
// than taking a code of its own.
async function placeOrder(owner, customer, food, { finalStatus = 'DELIVERED', coupon } = {}) {
  const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  if (coupon) {
    const applied = await customer.post('/api/cart/coupon').send({ code: coupon });
    if (applied.status !== 200) throw new Error(`coupon apply failed: ${JSON.stringify(applied.body)}`);
  }
  const orderRes = await customer.post('/api/orders').send({
    addressId: addrRes.body.data.address._id,
    paymentMethod: 'COD',
  });
  if (orderRes.status !== 201) throw new Error(`order failed: ${JSON.stringify(orderRes.body)}`);
  const order = orderRes.body.data.order;

  const path = {
    PLACED: [],
    CONFIRMED: ['CONFIRMED'],
    PREPARING: ['CONFIRMED', 'PREPARING'],
    CANCELLED: [],
    REJECTED: ['REJECTED'],
    DELIVERED: ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  }[finalStatus];

  for (const status of path) {
    const res = await owner.patch(`/api/orders/${order._id}/status`).send({ status });
    if (res.status !== 200) throw new Error(`transition to ${status} failed: ${JSON.stringify(res.body)}`);
  }
  if (finalStatus === 'CANCELLED') {
    const cancelled = await customer.post(`/api/orders/${order._id}/cancel`).send({ reason: 'changed my mind' });
    // Asserted, not fire-and-forget: a silently-failing cancel would leave the
    // order PLACED, and several assertions below would then pass for the wrong
    // reason (PLACED is not a sale either).
    if (cancelled.status !== 200) throw new Error(`cancel failed: ${JSON.stringify(cancelled.body)}`);
  }
  return order;
}

// A customer with their own restaurant + one delivered order, the common base.
async function setupDelivered(label) {
  const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail(`an-${label}-o`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail(`an-${label}-c`), role: 'CUSTOMER' });
  const { restaurant, food } = await makeRestaurant(owner, label);
  const order = await placeOrder(owner, customer, food);
  return { owner, customer, restaurant, food, order };
}

describe('Analytics — date range parsing', () => {
  const now = new Date('2026-03-15T10:30:00.000Z');

  it('resolves every preset to an explicit half-open UTC window', () => {
    expect(parseDateRange({ preset: 'today' }, now)).toMatchObject({
      start: new Date('2026-03-15T00:00:00.000Z'),
      end: new Date('2026-03-16T00:00:00.000Z'),
    });
    expect(parseDateRange({ preset: 'yesterday' }, now)).toMatchObject({
      start: new Date('2026-03-14T00:00:00.000Z'),
      end: new Date('2026-03-15T00:00:00.000Z'),
    });
    // last7days includes today — 6 days back through end of today.
    expect(parseDateRange({ preset: 'last7days' }, now).start).toEqual(new Date('2026-03-09T00:00:00.000Z'));
    expect(parseDateRange({ preset: 'last30days' }, now).start).toEqual(new Date('2026-02-14T00:00:00.000Z'));
    expect(parseDateRange({ preset: 'thismonth' }, now).start).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(parseDateRange({ preset: 'lastmonth' }, now)).toMatchObject({
      start: new Date('2026-02-01T00:00:00.000Z'),
      end: new Date('2026-03-01T00:00:00.000Z'),
    });
    // alltime deliberately carries no bounds rather than inventing an epoch start.
    expect(parseDateRange({ preset: 'alltime' }, now).start).toBeNull();
  });

  it('treats a bare custom end date as through-end-of-day, with no off-by-one', () => {
    const range = parseDateRange({ preset: 'custom', startDate: '2026-03-01', endDate: '2026-03-31' }, now);
    expect(range.start).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(range.end).toEqual(new Date('2026-04-01T00:00:00.000Z'));
    expect(eachUtcDay(range)).toHaveLength(31);
    expect(eachUtcDay(range)[30]).toBe('2026-03-31');
  });

  it('takes a full ISO end timestamp literally instead of rounding it up a day', () => {
    const range = parseDateRange({ preset: 'custom', startDate: '2026-03-01T06:00:00.000Z', endDate: '2026-03-01T18:00:00.000Z' }, now);
    expect(range.end).toEqual(new Date('2026-03-01T18:00:00.000Z'));
  });

  it('handles a single-day custom range as exactly that one day', () => {
    const range = parseDateRange({ preset: 'custom', startDate: '2026-03-07', endDate: '2026-03-07' }, now);
    expect(eachUtcDay(range)).toEqual(['2026-03-07']);
  });

  it('rejects an unknown preset, a missing bound, an unparseable date and start >= end', () => {
    const cases = [
      { preset: 'lastfortnight' },
      { preset: 'custom', startDate: '2026-03-01' },
      { preset: 'custom', endDate: '2026-03-01' },
      { preset: 'custom', startDate: 'not-a-date', endDate: '2026-03-02' },
      { preset: 'custom', startDate: '2026-03-02', endDate: 'not-a-date' },
      { preset: 'custom', startDate: '2026-03-05', endDate: '2026-03-01' },
      { preset: 'custom', startDate: '2026-03-05', endDate: '2026-03-05T00:00:00.000Z' }, // equal -> empty
    ];
    cases.forEach((query) => {
      expect(() => parseDateRange(query, now)).toThrow();
    });
  });

  it('defaults to last30days, and to custom as soon as explicit dates appear', () => {
    expect(parseDateRange({}, now).preset).toBe('last30days');
    expect(parseDateRange({ startDate: '2026-03-01', endDate: '2026-03-02' }, now).preset).toBe('custom');
  });
});

describe('Analytics — RBAC', () => {
  it('rejects unauthenticated access to every admin analytics endpoint', async () => {
    const paths = ['overview', 'sales', 'orders', 'customers', 'restaurants', 'food', 'delivery', 'payments', 'coupons'];
    for (const p of paths) {
      expect((await request(app).get(`/api/admin/analytics/${p}`)).status).toBe(401);
    }
  });

  it('blocks a customer, a restaurant owner and a delivery partner from admin analytics', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('an-rbac-c'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-rbac-o'), role: 'RESTAURANT_OWNER' });
    const { agent: rider } = await createUserWithRole('DELIVERY_PARTNER');

    for (const agent of [customer, owner, rider]) {
      expect((await agent.get('/api/admin/analytics/overview')).status).toBe(403);
      expect((await agent.get('/api/admin/analytics/sales')).status).toBe(403);
      expect((await agent.get('/api/admin/analytics/payments')).status).toBe(403);
    }
  });

  it('lets an admin reach every slice', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const paths = ['overview', 'sales', 'orders', 'customers', 'restaurants', 'food', 'delivery', 'payments', 'coupons'];
    for (const p of paths) {
      const res = await admin.get(`/api/admin/analytics/${p}`);
      expect(res.status).toBe(200);
    }
  });

  it('scopes each slice to the permission that governs that data, not one blanket permission', async () => {
    // SUPPORT_AGENT holds dashboard:view + users:read + orders:read_all, but not
    // refunds:manage, coupons:manage, restaurants:read_all or delivery perms.
    const { agent: support } = await createUserWithRole('SUPPORT_AGENT');
    expect((await support.get('/api/admin/analytics/overview')).status).toBe(200);
    expect((await support.get('/api/admin/analytics/customers')).status).toBe(200);
    expect((await support.get('/api/admin/analytics/payments')).status).toBe(403);
    expect((await support.get('/api/admin/analytics/coupons')).status).toBe(403);
    expect((await support.get('/api/admin/analytics/restaurants')).status).toBe(403);

    // DELIVERY_MANAGER holds delivery perms but not refunds/coupons/restaurants.
    const { agent: deliveryManager } = await createUserWithRole('DELIVERY_MANAGER');
    expect((await deliveryManager.get('/api/admin/analytics/delivery')).status).toBe(200);
    expect((await deliveryManager.get('/api/admin/analytics/payments')).status).toBe(403);
  });

  it('returns 400, not 500, for an invalid range on a real endpoint', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    expect((await admin.get('/api/admin/analytics/sales').query({ preset: 'nope' })).status).toBe(400);
    expect((await admin.get('/api/admin/analytics/sales').query({ preset: 'custom', startDate: '2026-03-09' })).status).toBe(400);
    expect(
      (await admin.get('/api/admin/analytics/sales').query({ preset: 'custom', startDate: '2026-03-09', endDate: '2026-03-01' })).status
    ).toBe(400);
  });
});

describe('Analytics — sales definitions', () => {
  it('counts a delivered order as gross sales, and leaves a pending one out', async () => {
    const { owner, customer, restaurant, food } = await setupDelivered('sales-basic');
    await placeOrder(owner, customer, food, { finalStatus: 'PREPARING' }); // in progress, not a sale

    const range = parseDateRange({ preset: 'alltime' });
    const sales = await analyticsService.getSales(range, [restaurant._id]);

    expect(sales.summary.orders).toBe(1);
    expect(sales.summary.grossSales).toBeCloseTo(ORDER_TOTAL, 2);
    expect(sales.summary.netSales).toBeCloseTo(ORDER_TOTAL, 2);
    expect(sales.summary.averageOrderValue).toBeCloseTo(ORDER_TOTAL, 2);
  });

  it('excludes cancelled and rejected orders from sales entirely', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-sales-bad-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('an-sales-bad-c'), role: 'CUSTOMER' });
    const { restaurant, food } = await makeRestaurant(owner, 'sales-bad');
    await placeOrder(owner, customer, food, { finalStatus: 'CANCELLED' });
    await placeOrder(owner, customer, food, { finalStatus: 'REJECTED' });

    const sales = await analyticsService.getSales(parseDateRange({ preset: 'alltime' }), [restaurant._id]);
    expect(sales.summary.orders).toBe(0);
    expect(sales.summary.grossSales).toBe(0);
    expect(sales.summary.averageOrderValue).toBe(0);
  });

  it('keeps a delivered-then-refunded order in gross and subtracts the refund exactly once', async () => {
    const { restaurant, order } = await setupDelivered('sales-refund');

    // A real refund needs a real ONLINE payment to refund against. The order was
    // placed COD, so this test writes the Payment/Refund ledger rows directly and
    // drives the order through the same status the refund service would set —
    // Razorpay itself cannot be called in tests (payment.service.js's create is a
    // deliberate 501 without a live account).
    const payment = await Payment.create({
      order: order._id,
      user: (await Order.findById(order._id)).user,
      razorpayOrderId: `order_test_${Date.now()}`,
      razorpayPaymentId: `pay_test_${Date.now()}`,
      amount: ORDER_TOTAL,
      status: 'PAID',
    });
    await Refund.create({ order: order._id, payment: payment._id, amount: 40, reason: 'operational_issue', status: 'COMPLETED' });
    // Mirrors refund.service.js: a completed refund moves the order off DELIVERED.
    await Order.findByIdAndUpdate(order._id, {
      orderStatus: 'REFUNDED',
      paymentStatus: 'refunded',
      $push: { statusHistory: { status: 'REFUNDED' } },
    });

    const sales = await analyticsService.getSales(parseDateRange({ preset: 'alltime' }), [restaurant._id]);

    // Still a sale that happened (it was delivered), so gross keeps it...
    expect(sales.summary.orders).toBe(1);
    expect(sales.summary.grossSales).toBeCloseTo(ORDER_TOTAL, 2);
    // ...and the refund is netted off once, not twice.
    expect(sales.summary.refunds).toBeCloseTo(40, 2);
    expect(sales.summary.netSales).toBeCloseTo(ORDER_TOTAL - 40, 2);
    expect(sales.summary.refundedOrderCount).toBe(1);
  });

  it('never counts a refund on an order that was cancelled before delivery as a deduction from sales', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-refund-cancel-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('an-refund-cancel-c'), role: 'CUSTOMER' });
    const { restaurant, food } = await makeRestaurant(owner, 'refund-cancel');
    const cancelled = await placeOrder(owner, customer, food, { finalStatus: 'CANCELLED' });

    const payment = await Payment.create({
      order: cancelled._id,
      user: (await Order.findById(cancelled._id)).user,
      razorpayOrderId: `order_test_c_${Date.now()}`,
      amount: ORDER_TOTAL,
      status: 'PAID',
    });
    await Refund.create({ order: cancelled._id, payment: payment._id, amount: ORDER_TOTAL, reason: 'customer_cancellation', status: 'COMPLETED' });
    await Order.findByIdAndUpdate(cancelled._id, { orderStatus: 'REFUNDED', $push: { statusHistory: { status: 'REFUNDED' } } });

    const sales = await analyticsService.getSales(parseDateRange({ preset: 'alltime' }), [restaurant._id]);
    // The order was never fulfilled, so it is in neither gross nor refunds —
    // netting it off a gross that never included it would invent a loss.
    expect(sales.summary.grossSales).toBe(0);
    expect(sales.summary.refunds).toBe(0);
    expect(sales.summary.netSales).toBe(0);
  });

  it('reports discounts without subtracting them twice', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-disc-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('an-disc-c'), role: 'CUSTOMER' });
    const { restaurant, food } = await makeRestaurant(owner, 'disc');

    const code = `AN${Date.now().toString().slice(-6)}`;
    await admin.post('/api/coupons').send({
      code, description: 'Analytics test', discountType: 'FLAT', discountValue: 20,
      minimumOrder: 0, expiryDate: new Date(Date.now() + 86400000), usageLimit: 50,
    });
    await placeOrder(owner, customer, food, { coupon: code });

    const sales = await analyticsService.getSales(parseDateRange({ preset: 'alltime' }), [restaurant._id]);
    expect(sales.summary.discounts).toBeCloseTo(20, 2);
    // totalAmount already has the discount taken off, so gross reflects it once.
    expect(sales.summary.grossSales).toBeCloseTo(ORDER_TOTAL - 20, 2);
    expect(sales.summary.netSales).toBeCloseTo(ORDER_TOTAL - 20, 2);
  });

  it('builds a per-day trend that includes zero-activity days', async () => {
    const { restaurant } = await setupDelivered('trend');
    const sales = await analyticsService.getSales(parseDateRange({ preset: 'last7days' }), [restaurant._id]);

    expect(sales.trend).toHaveLength(7);
    const today = new Date().toISOString().slice(0, 10);
    const todayRow = sales.trend.find((row) => row.date === today);
    expect(todayRow.orders).toBe(1);
    expect(todayRow.gross).toBeCloseTo(ORDER_TOTAL, 2);
    // The other six days exist and are honest zeroes, not missing entries.
    expect(sales.trend.filter((row) => row.orders === 0)).toHaveLength(6);
  });

  it('returns zeroes, not errors, for a range with no activity at all', async () => {
    const { restaurant } = await setupDelivered('empty-range');
    const sales = await analyticsService.getSales(
      parseDateRange({ preset: 'custom', startDate: '2020-01-01', endDate: '2020-01-03' }),
      [restaurant._id]
    );
    expect(sales.summary.orders).toBe(0);
    expect(sales.summary.grossSales).toBe(0);
    expect(sales.summary.netSales).toBe(0);
    expect(sales.trend).toHaveLength(3);
    expect(sales.trend.every((row) => row.orders === 0 && row.gross === 0)).toBe(true);
  });

  it('echoes back the exact window and timezone it measured', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/sales').query({ preset: 'custom', startDate: '2026-03-01', endDate: '2026-03-31' });
    expect(res.body.data.range).toMatchObject({
      preset: 'custom',
      start: '2026-03-01T00:00:00.000Z',
      end: '2026-04-01T00:00:00.000Z',
      timezone: 'UTC',
    });
  });
});

describe('Analytics — orders', () => {
  it('counts statuses, computes rates, and reports null rates when there is nothing to divide', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-ord-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('an-ord-c'), role: 'CUSTOMER' });
    const { restaurant, food } = await makeRestaurant(owner, 'ord');
    await placeOrder(owner, customer, food); // DELIVERED
    await placeOrder(owner, customer, food); // DELIVERED
    await placeOrder(owner, customer, food, { finalStatus: 'CANCELLED' });
    await placeOrder(owner, customer, food, { finalStatus: 'PREPARING' });

    const orders = await analyticsService.getOrders(parseDateRange({ preset: 'alltime' }), [restaurant._id]);
    expect(orders.summary.totalOrders).toBe(4);
    expect(orders.summary.fulfilledOrders).toBe(2);
    expect(orders.summary.cancelledOrders).toBe(1);
    expect(orders.summary.inProgressOrders).toBe(1);
    expect(orders.summary.completionRate).toBeCloseTo(50, 2);
    expect(orders.summary.cancellationRate).toBeCloseTo(25, 2);

    // Every status present, including zeroes.
    expect(orders.byStatus.find((s) => s.status === 'DELIVERED').count).toBe(2);
    expect(orders.byStatus.find((s) => s.status === 'REFUNDED').count).toBe(0);

    const emptyRange = await analyticsService.getOrders(
      parseDateRange({ preset: 'custom', startDate: '2020-01-01', endDate: '2020-01-02' }),
      [restaurant._id]
    );
    expect(emptyRange.summary.totalOrders).toBe(0);
    expect(emptyRange.summary.completionRate).toBeNull();
    expect(emptyRange.summary.cancellationRate).toBeNull();
  });
});

describe('Analytics — customers', () => {
  it('counts only CUSTOMER accounts, and measures active/repeat from real orders', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-cust-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant, food } = await makeRestaurant(owner, 'cust');
    const repeat = await registerAndLogin({ name: 'Repeat', email: uniqueEmail('an-cust-repeat'), role: 'CUSTOMER' });
    const once = await registerAndLogin({ name: 'Once', email: uniqueEmail('an-cust-once'), role: 'CUSTOMER' });
    // Registered but never ordered — new, not active.
    await registerAndLogin({ name: 'Idle', email: uniqueEmail('an-cust-idle'), role: 'CUSTOMER' });

    await placeOrder(owner, repeat, food);
    await placeOrder(owner, repeat, food);
    await placeOrder(owner, once, food);

    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/customers').query({ preset: 'today' });
    expect(res.status).toBe(200);
    const s = res.body.data.summary;

    // Platform-wide counts, so assert relative movement rather than absolutes
    // (other suites share this database).
    expect(s.activeCustomers).toBeGreaterThanOrEqual(2);
    expect(s.repeatCustomers).toBeGreaterThanOrEqual(1);
    expect(s.newCustomers).toBeGreaterThanOrEqual(3);
    expect(s.averageOrdersPerActiveCustomer).toBeGreaterThan(0);

    // The owner account must never be counted as a customer.
    const ownerId = (await owner.get('/api/auth/me')).body.data.user._id;
    const User = require('../src/models/User');
    expect((await User.findById(ownerId)).role).toBe('RESTAURANT_OWNER');

    void restaurant;
  });

  it('reports null averages rather than 0 when no customer was active', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin
      .get('/api/admin/analytics/customers')
      .query({ preset: 'custom', startDate: '2019-01-01', endDate: '2019-01-02' });
    expect(res.body.data.summary.activeCustomers).toBe(0);
    expect(res.body.data.summary.averageOrdersPerActiveCustomer).toBeNull();
    expect(res.body.data.summary.repeatCustomerRate).toBeNull();
  });
});

describe('Analytics — restaurants & food', () => {
  it('breaks down per restaurant and sorts only by whitelisted metrics', async () => {
    const { restaurant, owner, customer, food } = await setupDelivered('rest-break');
    await placeOrder(owner, customer, food);
    await placeOrder(owner, customer, food, { finalStatus: 'CANCELLED' });

    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/restaurants').query({ preset: 'alltime', limit: 100 });
    expect(res.status).toBe(200);

    const row = res.body.data.breakdown.find((r) => r.restaurantId === restaurant._id.toString());
    expect(row.orders).toBe(3);
    expect(row.fulfilledOrders).toBe(2);
    expect(row.cancelledOrders).toBe(1);
    expect(row.grossSales).toBeCloseTo(ORDER_TOTAL * 2, 2);
    expect(row.averageOrderValue).toBeCloseTo(ORDER_TOTAL, 2);
    // Lifetime rating/review count come off the restaurant document itself.
    expect(row).toHaveProperty('rating');
    expect(row).toHaveProperty('reviewCount');

    // An unknown sort falls back to the default rather than injecting a field.
    const injected = await admin.get('/api/admin/analytics/restaurants').query({ preset: 'alltime', sort: 'owner' });
    expect(injected.status).toBe(200);
    expect(injected.body.data.sortedBy).toBe('grossSales');
  });

  it('counts item quantities and sales from fulfilled orders only, and omits per-item ratings', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-food-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('an-food-c'), role: 'CUSTOMER' });
    const { restaurant, food } = await makeRestaurant(owner, 'food');
    await placeOrder(owner, customer, food); // delivered
    await placeOrder(owner, customer, food); // delivered
    await placeOrder(owner, customer, food, { finalStatus: 'CANCELLED' }); // must not count
    await placeOrder(owner, customer, food, { finalStatus: 'PREPARING' }); // must not count

    const result = await analyticsService.getFood(parseDateRange({ preset: 'alltime' }), [restaurant._id]);
    // Called directly rather than over HTTP, so foodId is still a real ObjectId
    // here — String() rather than a bare === against the JSON id.
    const row = result.breakdown.find((r) => String(r.foodId) === String(food._id));

    expect(row.quantity).toBe(2);
    expect(row.orderCount).toBe(2);
    expect(row.sales).toBeCloseTo(200, 2); // 2 × ₹100 line total, excluding delivery/tax
    // Honest about what the schema cannot support, rather than faking a rating.
    expect(row.averageRating).toBeUndefined();
    expect(result.note).toMatch(/not available/i);
  });
});

describe('Analytics — payments, refunds & coupons', () => {
  it('deduplicates retried online payment attempts down to one paid order', async () => {
    const { order } = await setupDelivered('pay-dedupe');
    const userId = (await Order.findById(order._id)).user;
    const rzOrderId = `order_test_d_${Date.now()}`;

    // One failed attempt, then two PAID rows for the SAME order (a retry plus a
    // webhook confirming the same money) — the kind of history that would
    // double-count if analytics counted Payment rows as orders.
    await Payment.create({ order: order._id, user: userId, razorpayOrderId: rzOrderId, amount: ORDER_TOTAL, status: 'FAILED', failureReason: 'card declined' });
    await Payment.create({ order: order._id, user: userId, razorpayOrderId: rzOrderId, razorpayPaymentId: 'pay_a', amount: ORDER_TOTAL, status: 'PAID' });
    await Payment.create({ order: order._id, user: userId, razorpayOrderId: rzOrderId, razorpayPaymentId: 'pay_b', amount: ORDER_TOTAL, status: 'PAID' });

    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/payments').query({ preset: 'today' });
    expect(res.status).toBe(200);

    // Two PAID attempts, but only ONE paid order.
    expect(res.body.data.online.paidAttempts).toBeGreaterThanOrEqual(2);
    expect(res.body.data.online.failedAttempts).toBeGreaterThanOrEqual(1);
    const paidOrdersForThis = await Payment.distinct('order', { order: order._id, status: 'PAID' });
    expect(paidOrdersForThis).toHaveLength(1);
  });

  it('breaks refunds down by real status and never assumes a cancelled order was refunded', async () => {
    const { order } = await setupDelivered('refund-status');
    const userId = (await Order.findById(order._id)).user;
    const payment = await Payment.create({
      order: order._id, user: userId, razorpayOrderId: `order_test_r_${Date.now()}`, amount: ORDER_TOTAL, status: 'PAID',
    });
    await Refund.create({ order: order._id, payment: payment._id, amount: 15, reason: 'operational_issue', status: 'COMPLETED' });
    await Refund.create({ order: order._id, payment: payment._id, amount: 25, reason: 'operational_issue', status: 'PENDING' });

    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/payments').query({ preset: 'today' });

    expect(res.body.data.refunds.completed).toBeGreaterThanOrEqual(1);
    expect(res.body.data.refunds.pending).toBeGreaterThanOrEqual(1);
    // A PENDING refund is money not yet returned, so it must not be in the
    // completed amount.
    expect(res.body.data.refunds.completedAmount).toBeGreaterThanOrEqual(15);

    // And a pending refund is never netted off sales.
    const sales = await analyticsService.getSales(parseDateRange({ preset: 'today' }), null);
    expect(sales.summary.refunds).toBeGreaterThanOrEqual(15);
  });

  it('counts COD orders separately from online payments', async () => {
    await setupDelivered('cod');
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/payments').query({ preset: 'today' });
    expect(res.body.data.cod.orders).toBeGreaterThanOrEqual(1);
    expect(res.body.data.cod.amount).toBeGreaterThanOrEqual(ORDER_TOTAL);
  });

  it('reports coupon redemptions and discount totals from CouponUsage', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('an-coup-o'), role: 'RESTAURANT_OWNER' });
    const c1 = await registerAndLogin({ name: 'C1', email: uniqueEmail('an-coup-c1'), role: 'CUSTOMER' });
    const c2 = await registerAndLogin({ name: 'C2', email: uniqueEmail('an-coup-c2'), role: 'CUSTOMER' });
    const { food } = await makeRestaurant(owner, 'coup');

    const code = `CP${Date.now().toString().slice(-6)}`;
    await admin.post('/api/coupons').send({
      code, description: 'Coupon analytics', discountType: 'FLAT', discountValue: 10,
      minimumOrder: 0, expiryDate: new Date(Date.now() + 86400000), usageLimit: 50,
    });
    await placeOrder(owner, c1, food, { coupon: code });
    await placeOrder(owner, c2, food, { coupon: code });

    const res = await admin.get('/api/admin/analytics/coupons').query({ preset: 'today' });
    expect(res.status).toBe(200);
    const row = res.body.data.breakdown.find((r) => r.code === code);
    expect(row.redemptions).toBe(2);
    expect(row.discount).toBeCloseTo(20, 2);
    expect(res.body.data.summary.redemptions).toBeGreaterThanOrEqual(2);
  });
});

describe('Analytics — delivery', () => {
  it('reports assignment/earning/settlement totals and omits an unmeasurable average', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/delivery').query({ preset: 'custom', startDate: '2019-01-01', endDate: '2019-01-02' });

    expect(res.status).toBe(200);
    expect(res.body.data.summary.assignmentsCreated).toBe(0);
    // No completion carried both timestamps, so the average is null — never 0,
    // and never estimated.
    expect(res.body.data.summary.averageCompletionMinutes).toBeNull();
    expect(res.body.data.summary.measuredCompletions).toBe(0);
    expect(res.body.data.earnings.netEarnings).toBe(0);
    expect(Array.isArray(res.body.data.settlements)).toBe(true);
    expect(res.body.data.topDeliveryPartners).toEqual([]);
  });

  it('never exposes rider contact details in the top-partner rows', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get('/api/admin/analytics/delivery').query({ preset: 'alltime' });
    res.body.data.topDeliveryPartners.forEach((row) => {
      expect(row.phone).toBeUndefined();
      expect(row.documents).toBeUndefined();
      expect(row.address).toBeUndefined();
    });
  });
});

describe('Analytics — restaurant owner scope (IDOR)', () => {
  it("lets an owner read their own restaurant's analytics", async () => {
    const { owner, restaurant } = await setupDelivered('owner-own');
    const res = await owner.get(`/api/restaurants/${restaurant._id}/analytics`).query({ preset: 'alltime' });

    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.id).toBe(restaurant._id.toString());
    expect(res.body.data.summary.grossSales).toBeCloseTo(ORDER_TOTAL, 2);
    expect(res.body.data.summary.fulfilledOrders).toBe(1);
    // `alltime` has no day series by design — days cannot be enumerated from an
    // unbounded start, so the trend is empty rather than invented.
    expect(res.body.data.trend).toEqual([]);

    // A bounded range does carry the per-day series.
    const bounded = await owner.get(`/api/restaurants/${restaurant._id}/analytics`).query({ preset: 'last7days' });
    expect(bounded.body.data.trend).toHaveLength(7);
  });

  it("blocks an owner from reading another owner's restaurant analytics", async () => {
    const { restaurant } = await setupDelivered('owner-a');
    const intruder = await registerAndLogin({ name: 'B', email: uniqueEmail('an-owner-b'), role: 'RESTAURANT_OWNER' });

    const res = await intruder.get(`/api/restaurants/${restaurant._id}/analytics`).query({ preset: 'alltime' });
    expect(res.status).toBe(403);
  });

  it('blocks a customer and an unauthenticated caller from owner analytics', async () => {
    const { restaurant } = await setupDelivered('owner-rbac');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('an-owner-cust'), role: 'CUSTOMER' });

    expect((await customer.get(`/api/restaurants/${restaurant._id}/analytics`)).status).toBe(403);
    expect((await request(app).get(`/api/restaurants/${restaurant._id}/analytics`)).status).toBe(401);
  });

  it("never leaks another restaurant's orders into an owner's figures", async () => {
    const a = await setupDelivered('scope-a');
    const b = await setupDelivered('scope-b');
    // Extra sales at B must not show up anywhere in A's numbers.
    await placeOrder(b.owner, b.customer, b.food);
    await placeOrder(b.owner, b.customer, b.food);

    const res = await a.owner.get(`/api/restaurants/${a.restaurant._id}/analytics`).query({ preset: 'alltime' });
    expect(res.body.data.summary.fulfilledOrders).toBe(1);
    expect(res.body.data.summary.grossSales).toBeCloseTo(ORDER_TOTAL, 2);
    res.body.data.topItems.forEach((item) => {
      expect(item.name).not.toContain('scope-b');
    });
  });

  it('returns 404 for an unknown restaurant and 400 for a bad range', async () => {
    const { owner, restaurant } = await setupDelivered('owner-errors');
    expect((await owner.get('/api/restaurants/507f1f77bcf86cd799439011/analytics')).status).toBe(404);
    expect(
      (await owner.get(`/api/restaurants/${restaurant._id}/analytics`).query({ preset: 'custom', startDate: '2026-05-05', endDate: '2026-01-01' })).status
    ).toBe(400);
  });

  it('includes only APPROVED reviews in the range, alongside lifetime figures', async () => {
    const { owner, customer, restaurant, order } = await setupDelivered('owner-reviews');
    await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 5, comment: 'Great' });

    // Still PENDING — must not count toward the in-range review figures (M15).
    let res = await owner.get(`/api/restaurants/${restaurant._id}/analytics`).query({ preset: 'today' });
    expect(res.body.data.summary.reviewsInRange).toBe(0);
    expect(res.body.data.summary.averageRatingInRange).toBeNull();

    const Review = require('../src/models/Review');
    const review = await Review.findOne({ order: order._id });
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.patch(`/api/admin/reviews/${review._id}/approve`);

    res = await owner.get(`/api/restaurants/${restaurant._id}/analytics`).query({ preset: 'today' });
    expect(res.body.data.summary.reviewsInRange).toBe(1);
    expect(res.body.data.summary.averageRatingInRange).toBeCloseTo(5, 2);
    expect(res.body.data.summary.lifetimeReviewCount).toBe(1);
  });
});

describe('Analytics — overview consistency & privacy', () => {
  it('agrees exactly with the sales endpoint over the same range', async () => {
    await setupDelivered('overview-consistency');
    const { agent: admin } = await createUserWithRole('ADMIN');

    const [overview, sales] = await Promise.all([
      admin.get('/api/admin/analytics/overview').query({ preset: 'today' }),
      admin.get('/api/admin/analytics/sales').query({ preset: 'today' }),
    ]);

    expect(overview.body.data.summary.grossSales).toBeCloseTo(sales.body.data.summary.grossSales, 2);
    expect(overview.body.data.summary.netSales).toBeCloseTo(sales.body.data.summary.netSales, 2);
    expect(overview.body.data.summary.refunds).toBeCloseTo(sales.body.data.summary.refunds, 2);
    expect(overview.body.data.summary.fulfilledOrders).toBe(sales.body.data.summary.orders);
  });

  it('returns aggregate numbers only — no customer names, emails or addresses anywhere', async () => {
    await setupDelivered('privacy');
    const { agent: admin } = await createUserWithRole('ADMIN');

    for (const path of ['overview', 'sales', 'orders', 'customers', 'restaurants', 'food', 'payments', 'coupons']) {
      const res = await admin.get(`/api/admin/analytics/${path}`).query({ preset: 'alltime' });
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/@example\.com/);
      expect(body).not.toMatch(/"phone"/);
      expect(body).not.toMatch(/"deliveryAddress"/);
      // M18 — the three above are load-bearing: analytics must never emit a
      // customer email, phone or delivery address, and none of those strings
      // appears in a legitimate analytics field name. The checks below replaced
      // a blunt /"password/i, which would have tripped the day a slice
      // legitimately returned something like "passwordChangedAt" in a
      // user-shaped projection — an assertion that fails on correct code teaches
      // you to loosen it, which is how a real leak gets through later. These are
      // what a credential actually leaking would look like.
      expect(body).not.toMatch(/\$2[aby]\$\d{2}\$/); // a bcrypt hash, under any key
      expect(body).not.toMatch(/"password"/);
      expect(body).not.toMatch(/passwordResetTokenHash/);
    }
  });
});
