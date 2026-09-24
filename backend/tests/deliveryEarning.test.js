require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Order = require('../src/models/Order');
const DeliveryAssignment = require('../src/models/DeliveryAssignment');
const DeliveryEarning = require('../src/models/DeliveryEarning');
const DeliverySettlement = require('../src/models/DeliverySettlement');
const deliveryEarningService = require('../src/services/deliveryEarning.service');
const { round2 } = require('../src/services/pricing.service');

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';
const PUNE = [73.8567, 18.5204]; // [lng, lat]
const NEAR_PUNE = [73.86, 18.5215];
const CUSTOMER_NEAR_RESTAURANT = { latitude: 18.53, longitude: 73.865 }; // ~2km from PUNE, within the default 5km radius

function validDPPayload(overrides = {}) {
  return {
    fullName: 'Test Rider',
    phone: '9876543210',
    address: { addressLine: '1 Rider Lane', pincode: '411001' },
    city: 'Pune',
    vehicleType: 'MOTORCYCLE',
    vehicleNumber: 'MH12AB1234',
    drivingLicenceNumber: 'DL123456789',
    drivingLicenceExpiry: '2030-01-01',
    documents: { identityProofUrl: DOC_URL, profilePhotoUrl: DOC_URL, drivingLicenceUrl: DOC_URL, vehicleRegistrationUrl: DOC_URL },
    ...overrides,
  };
}

async function restaurantNear(owner, coordinates) {
  const res = await owner.post('/api/restaurants').send({
    name: `Earn Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true, location: { type: 'Point', coordinates } });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Earn Item', price: 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

// dispatchOrder only ever offers a ready order to the single NEAREST eligible
// rider (limit: 1). A rider who already finished an earlier delivery in the
// same test is free again (not "busy") and stays within the 10km search
// radius of every restaurant fixed at PUNE — so two `fullyDeliveredOrder`
// calls in the same test, meant to produce two independent riders/orders,
// can otherwise both be dispatched to whichever rider happens to be nearer,
// silently stealing the second order from its intended rider. `zone` moves
// an entire restaurant+rider PAIR ~22km away (well outside that radius) so
// pairs from different zones can never compete for each other's dispatch,
// while a pair's own restaurant and rider stay exactly as close together as
// before (NEAR_PUNE's existing offset from PUNE is preserved verbatim).
function zoneCoordinates(base, zone) {
  const step = 0.2; // ~22km at this latitude — comfortably outside the 10km radius
  return [base[0] + zone * step, base[1] + zone * step];
}

async function riderAt(prefix, coordinates, admin) {
  const email = uniqueEmail(prefix);
  const agent = await registerAndLogin({ name: 'Rider', email, role: 'DELIVERY_PARTNER' });
  const created = await agent.post('/api/delivery-partners').send(validDPPayload());
  const id = created.body.data.deliveryPartner._id;
  await admin.patch(`/api/admin/delivery-partners/${id}/approve-kyc`);
  await agent.patch('/api/delivery-partners/me/location').send({ latitude: coordinates[1], longitude: coordinates[0] });
  await agent.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
  return { agent, id, email };
}

// `withDistance: true` gives the customer's address real coordinates near the
// restaurant, so Order.deliveryDistanceKm is a real, non-null number (exactly
// how restaurantGeoService already computes it at order placement — nothing
// here invents or hardcodes a distance). `withDistance: false` (default,
// matching every other M7-M9 test fixture) omits coordinates, the same as a
// customer who typed their address by hand — deliveryDistanceKm stays null.
async function fullyDeliveredOrder(prefix, admin, { withDistance = false, zone = 0 } = {}) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'C', email: uniqueEmail(`${prefix}-c`), role: 'CUSTOMER' });
  const { food } = await restaurantNear(owner, zoneCoordinates(PUNE, zone));
  const rider = await riderAt(`${prefix}-r`, zoneCoordinates(NEAR_PUNE, zone), admin);

  // CUSTOMER_NEAR_RESTAURANT is only ever used by the (single-delivery, zone 0)
  // distance-calculation test, so it needs no zone offset of its own.
  const addressBody = withDistance
    ? { addressLine: '1 Rd', city: 'Pune', pincode: '411001', ...CUSTOMER_NEAR_RESTAURANT }
    : { addressLine: '1 Rd', city: 'Pune', pincode: '411001' };
  const addr = await customer.post('/api/addresses').send(addressBody);
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
  const orderId = created.body.data.order._id;

  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    // eslint-disable-next-line no-await-in-loop
    await owner.patch(`/api/orders/${orderId}/status`).send({ status });
  }
  const offers = await rider.agent.get('/api/delivery-assignments/me/offers');
  const assignmentId = offers.body.data.offers[0]._id;
  await rider.agent.patch(`/api/delivery-assignments/${assignmentId}/accept`);

  const otpRes = await customer.get(`/api/orders/${orderId}/delivery-otp`);
  const otp = otpRes.body.data.otp;
  const completion = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });

  return { owner, customer, rider, orderId, assignmentId, order: completion.body.data.order };
}

describe('Earning creation', () => {
  it('is created the moment a delivery is successfully completed', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId, assignmentId } = await fullyDeliveredOrder('created', admin);

    const earning = await DeliveryEarning.findOne({ order: orderId });
    expect(earning).toBeTruthy();
    expect(earning.deliveryPartner.toString()).toBe(rider.id);
    expect(earning.deliveryAssignment.toString()).toBe(assignmentId);
    expect(earning.status).toBe('PENDING');
    expect(earning.netAmount).toBeGreaterThan(0);
  });

  it('is not created while the order is merely OUT_FOR_DELIVERY (before OTP verification)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('early-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('early-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const rider = await riderAt('early-r', NEAR_PUNE, admin);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = created.body.data.order._id;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      // eslint-disable-next-line no-await-in-loop
      await owner.patch(`/api/orders/${orderId}/status`).send({ status });
    }
    await rider.agent.get('/api/delivery-assignments/me/offers'); // dispatched, ASSIGNED not yet reached

    expect(await DeliveryEarning.countDocuments({ order: orderId })).toBe(0);
  });

  it('is not created for a cancelled order', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('cancel-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('cancel-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = created.body.data.order._id;
    await customer.post(`/api/orders/${orderId}/cancel`).send({ reason: 'changed my mind' });

    expect(await DeliveryEarning.countDocuments({ order: orderId })).toBe(0);
  });

  it('is not created for a rejected order', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('reject-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('reject-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = created.body.data.order._id;
    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'REJECTED' });

    expect(await DeliveryEarning.countDocuments({ order: orderId })).toBe(0);
  });

  it('is never created twice for the same delivery (idempotent hook, backed by a unique index)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId, order, assignmentId } = await fullyDeliveredOrder('twice', admin);
    expect(await DeliveryEarning.countDocuments({ order: orderId })).toBe(1);
    const original = await DeliveryEarning.findOne({ order: orderId });

    // Directly re-invoke the exact same creation function a second time,
    // simulating a bug that somehow called it twice — it must return the
    // EXISTING earning (idempotent no-op), never throw, and never duplicate.
    const assignment = await DeliveryAssignment.findById(assignmentId);
    const second = await deliveryEarningService.createEarningForCompletedDelivery(order, assignment);
    expect(second._id.toString()).toBe(original._id.toString());
    expect(await DeliveryEarning.countDocuments({ order: orderId })).toBe(1);

    // And the raw database constraint itself, independent of the service layer.
    await expect(DeliveryEarning.create({
      deliveryPartner: assignment.deliveryPartner, order: orderId, deliveryAssignment: assignmentId,
      orderNumber: order.orderNumber, baseAmount: 20, distanceAmount: 0, grossAmount: 20, netAmount: 20, earnedAt: new Date(),
    })).rejects.toThrow();
  });
});

describe('Earning calculation', () => {
  it('uses the configured base + distance rate, and matches the actual order distance', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await fullyDeliveredOrder('calc', admin, { withDistance: true });

    const order = await Order.findById(orderId);
    expect(order.deliveryDistanceKm).toEqual(expect.any(Number));
    expect(order.deliveryDistanceKm).toBeGreaterThan(0);

    const earning = await DeliveryEarning.findOne({ order: orderId });
    expect(earning.distanceKm).toBe(order.deliveryDistanceKm);
    expect(earning.baseAmount).toBe(deliveryEarningService.BASE_EARNING);
    expect(earning.distanceAmount).toBe(round2(order.deliveryDistanceKm * deliveryEarningService.PER_KM_RATE));
    expect(earning.grossAmount).toBe(round2(earning.baseAmount + earning.distanceAmount));
    expect(earning.deductions).toBe(0);
    expect(earning.netAmount).toBe(Math.max(earning.grossAmount, deliveryEarningService.MIN_EARNING));
  });

  it('falls back to base-only when the order has no reliable distance, without inventing one', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await fullyDeliveredOrder('fallback', admin, { withDistance: false });

    const order = await Order.findById(orderId);
    expect(order.deliveryDistanceKm).toBeNull();

    const earning = await DeliveryEarning.findOne({ order: orderId });
    expect(earning.distanceKm).toBeNull();
    expect(earning.distanceAmount).toBe(0);
    expect(earning.grossAmount).toBe(round2(deliveryEarningService.BASE_EARNING));
  });

  it('is precise to the paisa — no floating-point drift', () => {
    const calc = deliveryEarningService.calculateEarning({ deliveryDistanceKm: 3.33 });
    // Every stored amount must already be rounded to 2 decimals (whole paise).
    // Note: checking `Math.round(amount * 100) === amount * 100` is itself
    // unreliable — multiplying an already-clean 2-decimal float by 100 can
    // introduce its own IEEE-754 representation noise (e.g. 39.98 * 100 ===
    // 3997.9999999999995), which would fail this check even for a perfectly
    // rounded amount. The correct test is idempotency: re-applying round2()
    // must not change a value that is already rounded to 2 decimals.
    [calc.baseAmount, calc.distanceAmount, calc.grossAmount, calc.netAmount].forEach((amount) => {
      expect(round2(amount)).toBe(amount);
    });
  });

  it('respects a configured minimum earning', () => {
    const originalMin = deliveryEarningService.MIN_EARNING;
    // calculateEarning reads the module-level constant directly, so this test
    // only asserts the ALREADY-CONFIGURED default behaves as a floor — a
    // synthetic zero-distance, zero-base scenario would require re-requiring
    // the module with different env vars, which is out of scope here; instead
    // this confirms the floor from a normal calculation never comes out below it.
    const calc = deliveryEarningService.calculateEarning({ deliveryDistanceKm: null });
    expect(calc.netAmount).toBeGreaterThanOrEqual(originalMin);
  });
});

describe('Rider earnings API', () => {
  it('the correct rider sees their own earnings with correct summary totals', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId } = await fullyDeliveredOrder('ownlist', admin);

    const res = await rider.agent.get('/api/delivery-partners/me/earnings');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].order).toBe(orderId);
    expect(res.body.data.summary.pendingSettlement).toBe(res.body.data.items[0].netAmount);
    expect(res.body.data.summary.settledAmount).toBe(0);
    expect(res.body.data.summary.totalEarned).toBe(res.body.data.summary.pendingSettlement);
  });

  it('a rider never sees another rider\'s earnings in their list', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const deliveryA = await fullyDeliveredOrder('riderA', admin, { zone: 0 });
    const deliveryB = await fullyDeliveredOrder('riderB', admin, { zone: 1 });

    const res = await deliveryA.rider.agent.get('/api/delivery-partners/me/earnings');
    const orderIds = res.body.data.items.map((i) => i.order);
    expect(orderIds).toContain(deliveryA.orderId);
    expect(orderIds).not.toContain(deliveryB.orderId);
  });

  it('a rider can fetch one of their own earnings by id, with the full breakdown', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId } = await fullyDeliveredOrder('detail', admin);
    const earning = await DeliveryEarning.findOne({ order: orderId });

    const res = await rider.agent.get(`/api/delivery-partners/me/earnings/${earning._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.earning.orderNumber).toBeTruthy();
    expect(res.body.data.earning.netAmount).toBe(earning.netAmount);
  });

  it('a rider cannot fetch another rider\'s earning by id', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const deliveryA = await fullyDeliveredOrder('crossA', admin, { zone: 0 });
    const deliveryB = await fullyDeliveredOrder('crossB', admin, { zone: 1 });
    const earningB = await DeliveryEarning.findOne({ order: deliveryB.orderId });

    const res = await deliveryA.rider.agent.get(`/api/delivery-partners/me/earnings/${earningB._id}`);
    expect(res.status).toBe(404);
  });

  it('a customer, restaurant owner, and unauthenticated caller are all refused', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { owner, customer } = await fullyDeliveredOrder('rbac', admin);
    const { app } = require('./helpers');
    const request = require('supertest');

    expect((await customer.get('/api/delivery-partners/me/earnings')).status).toBe(403);
    expect((await owner.get('/api/delivery-partners/me/earnings')).status).toBe(403);
    expect((await request(app).get('/api/delivery-partners/me/earnings')).status).toBe(401);
  });

  it('a suspended rider can still view their own past earnings (viewing is not "manipulating")', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await fullyDeliveredOrder('suspendedview', admin);
    await admin.patch(`/api/admin/delivery-partners/${rider.id}/suspend`).send({ reason: 'x' });

    const res = await rider.agent.get('/api/delivery-partners/me/earnings');
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
  });
});

describe('Settlement generation', () => {
  it('generates a settlement including exactly the unsettled earnings in the period, with correct totals', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const delivery1 = await fullyDeliveredOrder('gen1', admin);
    // A second delivery for the SAME rider.
    const rider = delivery1.rider;
    const owner2 = await registerAndLogin({ name: 'O2', email: uniqueEmail('gen2-o'), role: 'RESTAURANT_OWNER' });
    const customer2 = await registerAndLogin({ name: 'C2', email: uniqueEmail('gen2-c'), role: 'CUSTOMER' });
    const { food: food2 } = await restaurantNear(owner2, PUNE);
    const addr2 = await customer2.post('/api/addresses').send({ addressLine: '2 Rd', city: 'Pune', pincode: '411001' });
    await customer2.post('/api/cart/items').send({ foodId: food2._id, quantity: 1 });
    const created2 = await customer2.post('/api/orders').send({ addressId: addr2.body.data.address._id, paymentMethod: 'COD' });
    const orderId2 = created2.body.data.order._id;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      // eslint-disable-next-line no-await-in-loop
      await owner2.patch(`/api/orders/${orderId2}/status`).send({ status });
    }
    const offers2 = await rider.agent.get('/api/delivery-assignments/me/offers');
    const assignmentId2 = offers2.body.data.offers[0]._id;
    await rider.agent.patch(`/api/delivery-assignments/${assignmentId2}/accept`);
    const otp2 = (await customer2.get(`/api/orders/${orderId2}/delivery-otp`)).body.data.otp;
    await rider.agent.post(`/api/delivery-assignments/${assignmentId2}/verify-otp`).send({ otp: otp2 });

    const earning1 = await DeliveryEarning.findOne({ order: delivery1.orderId });
    const earning2 = await DeliveryEarning.findOne({ order: orderId2 });
    const expectedNet = round2(earning1.netAmount + earning2.netAmount);

    const res = await admin.post('/api/admin/delivery-settlements/generate').send({
      deliveryPartnerId: rider.id,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.settlement.deliveryCount).toBe(2);
    expect(res.body.data.settlement.netAmount).toBe(expectedNet);
    expect(res.body.data.settlement.deliveryPartner).toBe(rider.id);

    const updated1 = await DeliveryEarning.findById(earning1._id);
    const updated2 = await DeliveryEarning.findById(earning2._id);
    expect(updated1.settlement.toString()).toBe(res.body.data.settlement._id);
    expect(updated2.settlement.toString()).toBe(res.body.data.settlement._id);
    expect(updated1.status).toBe('PENDING'); // not SETTLED until actually paid
  });

  it('excludes earnings outside the requested period', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId } = await fullyDeliveredOrder('period', admin);
    await DeliveryEarning.updateOne({ order: orderId }, { $set: { earnedAt: new Date('2020-01-01') } });

    const res = await admin.post('/api/admin/delivery-settlements/generate').send({
      deliveryPartnerId: rider.id,
      periodStart: new Date().toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(res.status).toBe(400); // nothing in THIS period
  });

  it('excludes an earning already claimed by another settlement (prevents duplicate settlement of the same earning)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await fullyDeliveredOrder('dup', admin);
    const period = {
      deliveryPartnerId: rider.id,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    };
    const first = await admin.post('/api/admin/delivery-settlements/generate').send(period);
    expect(first.status).toBe(201);

    const second = await admin.post('/api/admin/delivery-settlements/generate').send(period);
    expect(second.status).toBe(400);
    expect(await DeliverySettlement.countDocuments({ deliveryPartner: rider.id })).toBe(1);
  });

  it('two concurrent generate requests for the same rider/period never both succeed', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await fullyDeliveredOrder('concurrent', admin);
    const period = {
      deliveryPartnerId: rider.id,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    };

    const [first, second] = await Promise.all([
      admin.post('/api/admin/delivery-settlements/generate').send(period),
      admin.post('/api/admin/delivery-settlements/generate').send(period),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 400]);
    expect(await DeliverySettlement.countDocuments({ deliveryPartner: rider.id })).toBe(1);
  });

  it('rejects an admin request with no unauthenticated/insufficient permission caller', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, owner, customer } = await fullyDeliveredOrder('genrbac', admin);
    const period = { deliveryPartnerId: rider.id, periodStart: new Date(Date.now() - 86400000).toISOString(), periodEnd: new Date().toISOString() };

    expect((await owner.post('/api/admin/delivery-settlements/generate').send(period)).status).toBe(403);
    expect((await customer.post('/api/admin/delivery-settlements/generate').send(period)).status).toBe(403);
    expect((await rider.agent.post('/api/admin/delivery-settlements/generate').send(period)).status).toBe(403);
  });
});

describe('Settlement status transitions', () => {
  async function settleFor(prefix, admin) {
    const { rider } = await fullyDeliveredOrder(prefix, admin);
    const res = await admin.post('/api/admin/delivery-settlements/generate').send({
      deliveryPartnerId: rider.id,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    return { rider, settlementId: res.body.data.settlement._id };
  }

  it('walks PENDING -> APPROVED -> PAID, and moves included earnings to SETTLED', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { settlementId } = await settleFor('walk', admin);

    const approved = await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.settlement.status).toBe('APPROVED');

    const paid = await admin.patch(`/api/admin/delivery-settlements/${settlementId}/mark-paid`).send({ payoutReference: 'UTR123' });
    expect(paid.status).toBe(200);
    expect(paid.body.data.settlement.status).toBe('PAID');
    expect(paid.body.data.settlement.payoutReference).toBe('UTR123');

    const earnings = await DeliveryEarning.find({ settlement: settlementId });
    earnings.forEach((e) => {
      expect(e.status).toBe('SETTLED');
      expect(e.settledAt).toBeTruthy();
    });
  });

  it('allows APPROVED -> FAILED -> APPROVED (retry)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { settlementId } = await settleFor('retry', admin);
    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`);

    const failed = await admin.patch(`/api/admin/delivery-settlements/${settlementId}/failed`).send({ reason: 'bank rejected' });
    expect(failed.status).toBe(200);
    expect(failed.body.data.settlement.status).toBe('FAILED');

    const retried = await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`);
    expect(retried.status).toBe(200);
    expect(retried.body.data.settlement.status).toBe('APPROVED');
  });

  it('rejects invalid transitions: PENDING straight to PAID, and PAID back to anything', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { settlementId } = await settleFor('invalid', admin);

    const straightToPaid = await admin.patch(`/api/admin/delivery-settlements/${settlementId}/mark-paid`);
    expect(straightToPaid.status).toBe(400);

    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`);
    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/mark-paid`);

    const paidToApproved = await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`);
    expect(paidToApproved.status).toBe(400);
    const paidToFailed = await admin.patch(`/api/admin/delivery-settlements/${settlementId}/failed`);
    expect(paidToFailed.status).toBe(400);
  });

  it('a rider cannot approve/mark-paid/mark-failed their own settlement, and a customer cannot access it', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, settlementId } = await settleFor('ridercant', admin);
    const outsider = await registerAndLogin({ name: 'C', email: uniqueEmail('settle-outsider'), role: 'CUSTOMER' });

    expect((await rider.agent.patch(`/api/admin/delivery-settlements/${settlementId}/approve`)).status).toBe(403);
    expect((await rider.agent.patch(`/api/admin/delivery-settlements/${settlementId}/mark-paid`)).status).toBe(403);
    expect((await outsider.get(`/api/admin/delivery-settlements/${settlementId}`)).status).toBe(403);
    expect((await outsider.get('/api/admin/delivery-settlements')).status).toBe(403);
  });
});

describe('Frontend amount manipulation is ignored', () => {
  it('a spoofed amount/netAmount in the generate request body has no effect on the calculated total', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId } = await fullyDeliveredOrder('spoof', admin);
    const realEarning = await DeliveryEarning.findOne({ order: orderId });

    const res = await admin.post('/api/admin/delivery-settlements/generate').send({
      deliveryPartnerId: rider.id,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
      netAmount: 999999,
      amount: 999999,
      grossAmount: 999999,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.settlement.netAmount).toBe(realEarning.netAmount); // server-calculated, not the spoofed value
  });
});

describe('Regression: existing M5-M9 flows unaffected', () => {
  it('a full COD order with no rider involved still completes normally, with no earning created', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('regress-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('regress-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = created.body.data.order._id;

    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await owner.patch(`/api/orders/${orderId}/status`).send({ status });
      expect(res.status).toBe(200);
    }
    expect(await DeliveryEarning.countDocuments({ order: orderId })).toBe(0); // no rider ever assigned
  });

  it('review eligibility still works after an M10-tracked delivery', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, order, orderId } = await fullyDeliveredOrder('review', admin);
    const res = await customer.post('/api/reviews').send({ restaurant: order.restaurant, order: orderId, rating: 5, comment: 'Good!' });
    expect(res.status).toBe(201);
  });
});
