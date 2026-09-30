require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole, submitRestaurantKyc } = require('./helpers');
const AuditLog = require('../src/models/AuditLog');
const auditService = require('../src/services/audit.service');
const Restaurant = require('../src/models/Restaurant');

async function pendingRestaurant() {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('au-owner'), role: 'RESTAURANT_OWNER' });
  const res = await owner.post('/api/restaurants').send({
    name: 'Audit Place', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
  });
  return { restaurant: res.body.data.restaurant, owner };
}

describe('audit logging', () => {
  it('records who approved a restaurant, with role, entity and request context', async () => {
    const { restaurant, owner } = await pendingRestaurant();
    const { agent, user } = await createUserWithRole('ADMIN');

    await submitRestaurantKyc(owner, restaurant._id).expect(200); // M14 — approval requires this first
    await agent.patch(`/api/admin/restaurants/${restaurant._id}/approve`).expect(200);

    const entries = await AuditLog.find({ action: 'restaurant.approve' });
    expect(entries).toHaveLength(1);
    expect(entries[0].actor.toString()).toBe(user._id.toString());
    expect(entries[0].actorRole).toBe('ADMIN');
    expect(entries[0].entityType).toBe('Restaurant');
    expect(entries[0].entityId.toString()).toBe(restaurant._id);
    expect(entries[0].metadata.name).toBe('Audit Place');
    expect(entries[0].createdAt).toBeInstanceOf(Date);
  });

  it('does not record anything when the action is rejected', async () => {
    const { restaurant } = await pendingRestaurant();
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('au-cust'), role: 'CUSTOMER' });
    await customer.patch(`/api/admin/restaurants/${restaurant._id}/approve`).expect(403);
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('records coupon changes and order overrides made by staff', async () => {
    const { agent } = await createUserWithRole('ADMIN');
    const created = await agent.post('/api/coupons').send({
      code: 'AUDIT10', discountType: 'PERCENTAGE', discountValue: 10, expiryDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(created.status).toBe(201);
    await agent.patch(`/api/coupons/${created.body.data.coupon._id}`).send({ isActive: false }).expect(200);

    const actions = (await AuditLog.find({}).sort('createdAt')).map((e) => e.action);
    expect(actions).toEqual(['coupon.create', 'coupon.update']);
  });

  it('redacts anything that looks like a credential before storing it', () => {
    const cleaned = auditService.redact({
      name: 'ok',
      password: 'hunter2',
      nested: { apiKey: 'abc', razorpaySignature: 'sig', authorization: 'Bearer x', keep: 'fine' },
      list: [{ token: 't', ok: 1 }],
    });
    expect(cleaned.password).toBe('[redacted]');
    expect(cleaned.nested.apiKey).toBe('[redacted]');
    expect(cleaned.nested.razorpaySignature).toBe('[redacted]');
    expect(cleaned.nested.authorization).toBe('[redacted]');
    expect(cleaned.nested.keep).toBe('fine');
    expect(cleaned.list[0].token).toBe('[redacted]');
    expect(cleaned.list[0].ok).toBe(1);
    expect(JSON.stringify(cleaned)).not.toMatch(/hunter2/);
  });

  it('never fails the admin action just because the audit write failed', async () => {
    const { restaurant, owner } = await pendingRestaurant();
    const { agent } = await createUserWithRole('ADMIN');
    await submitRestaurantKyc(owner, restaurant._id).expect(200); // M14 — approval requires this first
    const spy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('db down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await agent.patch(`/api/admin/restaurants/${restaurant._id}/approve`).expect(200);
    expect((await Restaurant.findById(restaurant._id)).isApproved).toBe(true);
    expect(errSpy).toHaveBeenCalled();

    spy.mockRestore();
    errSpy.mockRestore();
  });

  it('is append-only through the application layer', async () => {
    await auditService.record({ actor: { _id: null, role: 'ADMIN' }, action: 'test.event', metadata: {} });
    const entry = await AuditLog.findOne({ action: 'test.event' });

    entry.action = 'tampered';
    await expect(entry.save()).rejects.toThrow(/append-only/);
    await expect(AuditLog.updateOne({ _id: entry._id }, { action: 'x' }).exec()).rejects.toThrow(/append-only/);
    await expect(AuditLog.deleteMany({}).exec()).rejects.toThrow(/append-only/);
    expect(await AuditLog.countDocuments({ action: 'test.event' })).toBe(1);
  });

  it('lets a SUPER_ADMIN filter and paginate the log', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { agent: superAdmin } = await createUserWithRole('SUPER_ADMIN');
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await admin.post('/api/coupons').send({
        code: `LOG${i}`, discountType: 'FLAT', discountValue: 5, expiryDate: new Date(Date.now() + 86400000).toISOString(),
      });
    }
    const filtered = await superAdmin.get('/api/admin/audit-logs?action=coupon.create&limit=2');
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.logs).toHaveLength(2);
    expect(filtered.body.data.pagination.total).toBe(3);
    expect(filtered.body.data.logs[0].actor.role).toBe('ADMIN');
    expect(filtered.body.data.logs[0].actor.password).toBeUndefined();
  });

  it('gets a single audit log entry by id (SUPER_ADMIN only)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { agent: superAdmin } = await createUserWithRole('SUPER_ADMIN');
    const { restaurant, owner } = await pendingRestaurant();
    await submitRestaurantKyc(owner, restaurant._id).expect(200); // M14 — approval requires this first
    await admin.patch(`/api/admin/restaurants/${restaurant._id}/approve`);
    const entry = await AuditLog.findOne({ action: 'restaurant.approve' });

    const res = await superAdmin.get(`/api/admin/audit-logs/${entry._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.log.action).toBe('restaurant.approve');

    expect((await admin.get(`/api/admin/audit-logs/${entry._id}`)).status).toBe(403); // plain ADMIN lacks audit:read
    expect((await superAdmin.get(`/api/admin/audit-logs/${new (require('mongoose').Types.ObjectId)()}`)).status).toBe(404);
  });

  it('rejects every non-audit role from the audit log surface', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('au-noaccess-c'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('au-noaccess-o'), role: 'RESTAURANT_OWNER' });
    const rider = await registerAndLogin({ name: 'R', email: uniqueEmail('au-noaccess-r'), role: 'DELIVERY_PARTNER' });
    const { agent: admin } = await createUserWithRole('ADMIN'); // holds many permissions, but NOT audit:read
    expect((await customer.get('/api/admin/audit-logs')).status).toBe(403);
    expect((await owner.get('/api/admin/audit-logs')).status).toBe(403);
    expect((await rider.get('/api/admin/audit-logs')).status).toBe(403);
    expect((await admin.get('/api/admin/audit-logs')).status).toBe(403);
  });
});

describe('audit logging — integration with M6-M11 flows', () => {
  const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';
  const PUNE = [73.8567, 18.5204];

  function validDPPayload() {
    return {
      fullName: 'Audit Rider', phone: '9876543210', address: { addressLine: '1 Rider Lane', pincode: '411001' }, city: 'Pune',
      vehicleType: 'MOTORCYCLE', vehicleNumber: 'MH12AB1234', drivingLicenceNumber: 'DL123456789', drivingLicenceExpiry: '2030-01-01',
      documents: { identityProofUrl: DOC_URL, profilePhotoUrl: DOC_URL, drivingLicenceUrl: DOC_URL, vehicleRegistrationUrl: DOC_URL },
    };
  }

  // Owner + restaurant (at PUNE) + customer + order, fully delivered by one
  // approved, online rider — real dispatch, real accept, real OTP verification.
  async function fullyDeliveredOrder(prefix, admin) {
    const Restaurant = require('../src/models/Restaurant');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail(`${prefix}-c`), role: 'CUSTOMER' });
    const { setupOrderable } = require('./helpers');
    const { restaurant, food } = await setupOrderable(owner);
    await Restaurant.findByIdAndUpdate(restaurant._id, { location: { type: 'Point', coordinates: PUNE } });

    const rider = await registerAndLogin({ name: 'Rider', email: uniqueEmail(`${prefix}-r`), role: 'DELIVERY_PARTNER' });
    const createdRider = await rider.post('/api/delivery-partners').send(validDPPayload());
    const riderId = createdRider.body.data.deliveryPartner._id;
    await admin.patch(`/api/admin/delivery-partners/${riderId}/approve-kyc`);
    await rider.patch('/api/delivery-partners/me/location').send({ latitude: PUNE[1] + 0.003, longitude: PUNE[0] + 0.003 });
    await rider.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });

    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = created.body.data.order._id;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      // eslint-disable-next-line no-await-in-loop
      await owner.patch(`/api/orders/${orderId}/status`).send({ status });
    }
    const offers = await rider.get('/api/delivery-assignments/me/offers');
    const assignmentId = offers.body.data.offers[0]._id;
    await rider.patch(`/api/delivery-assignments/${assignmentId}/accept`);
    const otp = (await customer.get(`/api/orders/${orderId}/delivery-otp`)).body.data.otp;
    await rider.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });

    return { owner, customer, rider, riderId, orderId, assignmentId };
  }

  it('a manual delivery assignment creates an audit event', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('daa-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('daa-c'), role: 'CUSTOMER' });
    const Restaurant = require('../src/models/Restaurant');
    const { setupOrderable } = require('./helpers');
    const { restaurant, food } = await setupOrderable(owner);
    await Restaurant.findByIdAndUpdate(restaurant._id, { location: { type: 'Point', coordinates: PUNE } });

    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const order = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = order.body.data.order._id;
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      // eslint-disable-next-line no-await-in-loop
      await owner.patch(`/api/orders/${orderId}/status`).send({ status });
    }
    // The rider is onboarded only AFTER READY_FOR_PICKUP, so automatic dispatch
    // (which runs once, at that exact status change) found nobody — the order is
    // still unassigned, and the admin's manual /assign call below is a REAL
    // assignment, not a no-op alongside one auto-dispatch already made.
    const rider = await registerAndLogin({ name: 'R', email: uniqueEmail('daa-r'), role: 'DELIVERY_PARTNER' });
    const createdRider = await rider.post('/api/delivery-partners').send(validDPPayload());
    const riderId = createdRider.body.data.deliveryPartner._id;
    await admin.patch(`/api/admin/delivery-partners/${riderId}/approve-kyc`);
    await rider.patch('/api/delivery-partners/me/location').send({ latitude: PUNE[1], longitude: PUNE[0] });
    await rider.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });

    const assign = await admin.post(`/api/admin/orders/${orderId}/assign`).send({ deliveryPartnerId: riderId });
    expect(assign.status).toBe(201);

    const entries = await AuditLog.find({ action: 'order.assign_delivery_partner', entityId: orderId });
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.deliveryPartner).toBe(riderId);
  });

  it('OTP-verified delivery completion creates an audit event', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await fullyDeliveredOrder('daotp', admin);
    const entries = await AuditLog.find({ action: 'delivery.otp_verified', entityId: orderId });
    expect(entries).toHaveLength(1);
    expect(entries[0].actorRole).toBe('DELIVERY_PARTNER');
    expect(entries[0].metadata.orderNumber).toBeTruthy();
  });

  it('the settlement lifecycle (generate/approve/mark-paid) creates an audit event at each step', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { riderId } = await fullyDeliveredOrder('daset', admin);

    const gen = await admin.post('/api/admin/delivery-settlements/generate').send({
      deliveryPartnerId: riderId,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(gen.status).toBe(201);
    const settlementId = gen.body.data.settlement._id;

    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`).expect(200);
    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/mark-paid`).send({ payoutReference: 'UTR123' }).expect(200);

    const actions = (await AuditLog.find({ entityId: settlementId }).sort('createdAt')).map((e) => e.action);
    expect(actions).toEqual(['delivery_settlement.generate', 'delivery_settlement.approve', 'delivery_settlement.mark_paid']);
  });

  it('an automatic refund (from a customer cancellation) creates a refund.created audit event', async () => {
    const crypto = require('crypto');
    const KEY_ID = 'rzp_test_fakekey123';
    const KEY_SECRET = 'test_key_secret_XYZ';
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const sign = (orderId, paymentId, secret) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('darefund-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('darefund-c'), role: 'CUSTOMER' });
    const { setupOrderable } = require('./helpers');
    const { food } = await setupOrderable(owner);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'order_darefund', amount: 1, currency: 'INR' }));
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'ONLINE' });
    const orderId = created.body.data.order._id;
    const razorpayOrderId = created.body.data.razorpay.orderId;
    await customer.post(`/api/orders/${orderId}/verify-payment`).send({
      razorpayOrderId, razorpayPaymentId: 'pay_darefund', signature: sign(razorpayOrderId, 'pay_darefund', KEY_SECRET),
    });
    fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_darefund', amount: created.body.data.order.totalAmount * 100, status: 'processed' }));

    await customer.post(`/api/orders/${orderId}/cancel`).expect(200);

    const entries = await AuditLog.find({ action: 'refund.created' });
    expect(entries).toHaveLength(1);
    expect(entries[0].metadata.orderNumber).toBeTruthy();

    jest.restoreAllMocks();
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
  });

  it('support ticket create/assign/status-change all create audit events', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { user: agentUser } = await createUserWithRole('SUPPORT_AGENT');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('dastick-c'), role: 'CUSTOMER' });

    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const id = created.body.data.ticket._id;
    await admin.patch(`/api/admin/support/tickets/${id}/assign`).send({ assignedTo: agentUser._id });
    await admin.patch(`/api/admin/support/tickets/${id}/status`).send({ status: 'IN_PROGRESS' });

    const actions = (await AuditLog.find({ entityId: id }).sort('createdAt')).map((e) => e.action);
    expect(actions).toEqual(['support_ticket.create', 'support_ticket.assign', 'support_ticket.status_change']);
  });
});
