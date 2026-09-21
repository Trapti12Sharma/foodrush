require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const AuditLog = require('../src/models/AuditLog');
const auditService = require('../src/services/audit.service');
const Restaurant = require('../src/models/Restaurant');

async function pendingRestaurant() {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('au-owner'), role: 'RESTAURANT_OWNER' });
  const res = await owner.post('/api/restaurants').send({
    name: 'Audit Place', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
  });
  return res.body.data.restaurant;
}

describe('audit logging', () => {
  it('records who approved a restaurant, with role, entity and request context', async () => {
    const restaurant = await pendingRestaurant();
    const { agent, user } = await createUserWithRole('ADMIN');

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
    const restaurant = await pendingRestaurant();
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
    const restaurant = await pendingRestaurant();
    const { agent } = await createUserWithRole('ADMIN');
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
});
