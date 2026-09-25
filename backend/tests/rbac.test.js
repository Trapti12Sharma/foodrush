require('./setup');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable, submitRestaurantKyc } = require('./helpers');
const { ROLES } = require('../src/utils/constants');
const { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, getPermissions, hasPermission, isStaffRole } = require('../src/utils/permissions');
const Restaurant = require('../src/models/Restaurant');

describe('permission table', () => {
  it('defines an entry for every role', () => {
    Object.values(ROLES).forEach((role) => expect(ROLE_PERMISSIONS[role]).toBeDefined());
  });

  it('gives SUPER_ADMIN every permission and ADMIN exactly the legacy admin set', () => {
    expect(getPermissions(ROLES.SUPER_ADMIN).sort()).toEqual(Object.values(PERMISSIONS).sort());
    const admin = getPermissions(ROLES.ADMIN);
    [PERMISSIONS.AUDIT_READ, PERMISSIONS.ADMINS_MANAGE, PERMISSIONS.SETTINGS_MANAGE].forEach((p) => expect(admin).not.toContain(p));
    [PERMISSIONS.USERS_MANAGE, PERMISSIONS.RESTAURANTS_APPROVE, PERMISSIONS.COUPONS_MANAGE, PERMISSIONS.ORDERS_MANAGE].forEach((p) =>
      expect(admin).toContain(p)
    );
  });

  it('gives resource-scoped roles no platform-wide permissions', () => {
    [ROLES.CUSTOMER, ROLES.RESTAURANT_OWNER, ROLES.DELIVERY_PARTNER].forEach((role) => {
      expect(getPermissions(role)).toEqual([]);
      expect(isStaffRole(role)).toBe(false);
    });
    STAFF_ROLES.forEach((role) => expect(isStaffRole(role)).toBe(true));
  });

  it('treats an anonymous or unknown-role user as having no permissions', () => {
    expect(hasPermission(undefined, PERMISSIONS.DASHBOARD_VIEW)).toBe(false);
    expect(hasPermission({ role: 'NOT_A_ROLE' }, PERMISSIONS.DASHBOARD_VIEW)).toBe(false);
  });
});

describe('admin routes are gated by permission, per role', () => {
  it('returns 401 with no session and 403 for customers, owners and delivery partners', async () => {
    expect((await request(app).get('/api/admin/dashboard')).status).toBe(401);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('rb-cust'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('rb-owner'), role: 'RESTAURANT_OWNER' });
    const { agent: partner } = await createUserWithRole('DELIVERY_PARTNER');
    for (const agent of [customer, owner, partner]) {
      expect((await agent.get('/api/admin/dashboard')).status).toBe(403);
      expect((await agent.get('/api/admin/users')).status).toBe(403);
      expect((await agent.get('/api/coupons')).status).toBe(403);
    }
  });

  it('lets a SUPPORT_AGENT read users/orders but not approve restaurants or manage coupons', async () => {
    const { agent } = await createUserWithRole('SUPPORT_AGENT');
    expect((await agent.get('/api/admin/dashboard')).status).toBe(200);
    expect((await agent.get('/api/admin/users')).status).toBe(200);
    expect((await agent.get('/api/admin/orders')).status).toBe(200);
    expect((await agent.get('/api/admin/restaurants')).status).toBe(403);
    expect((await agent.get('/api/coupons')).status).toBe(403);
    expect((await agent.get('/api/admin/audit-logs')).status).toBe(403);
  });

  it('lets a RESTAURANT_MANAGER approve restaurants but not read users', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('rb-own2'), role: 'RESTAURANT_OWNER' });
    const created = await owner.post('/api/restaurants').send({
      name: 'Pending Place', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    const id = created.body.data.restaurant._id;
    const { agent: manager } = await createUserWithRole('RESTAURANT_MANAGER');

    expect((await manager.get('/api/admin/users')).status).toBe(403);
    // M14 — approval requires KYC documents to have been submitted first.
    await submitRestaurantKyc(owner, id).expect(200);
    const approve = await manager.patch(`/api/admin/restaurants/${id}/approve`);
    expect(approve.status).toBe(200);
    expect((await Restaurant.findById(id)).isApproved).toBe(true);
  });

  it('keeps ADMIN behaving exactly as before, while audit logs stay SUPER_ADMIN-only', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { agent: superAdmin } = await createUserWithRole('SUPER_ADMIN');
    for (const agent of [admin, superAdmin]) {
      expect((await agent.get('/api/admin/dashboard')).status).toBe(200);
      expect((await agent.get('/api/admin/restaurants')).status).toBe(200);
      expect((await agent.get('/api/coupons')).status).toBe(200);
    }
    expect((await admin.get('/api/admin/audit-logs')).status).toBe(403);
    expect((await superAdmin.get('/api/admin/audit-logs')).status).toBe(200);
  });

  it('exposes the role permissions on /auth/me for the UI', async () => {
    const { agent } = await createUserWithRole('SUPPORT_AGENT');
    const res = await agent.get('/api/auth/me');
    expect(res.body.data.user.permissions).toEqual(expect.arrayContaining([PERMISSIONS.ORDERS_READ_ALL]));
    expect(res.body.data.user.permissions).not.toContain(PERMISSIONS.COUPONS_MANAGE);
  });
});

describe('shared owner-or-staff routes and ownership checks', () => {
  it('lets ADMIN edit any restaurant, but not a SUPPORT_AGENT or a different owner', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('rb-own3'), role: 'RESTAURANT_OWNER' });
    const other = await registerAndLogin({ name: 'O2', email: uniqueEmail('rb-own4'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { agent: support } = await createUserWithRole('SUPPORT_AGENT');

    expect((await admin.put(`/api/restaurants/${restaurant._id}`).send({ deliveryFee: 12 })).status).toBe(200);
    expect((await support.put(`/api/restaurants/${restaurant._id}`).send({ deliveryFee: 99 })).status).toBe(403);
    expect((await other.put(`/api/restaurants/${restaurant._id}`).send({ deliveryFee: 99 })).status).toBe(403);
    expect((await Restaurant.findById(restaurant._id)).deliveryFee).toBe(12);
  });
});

describe('privilege guards on account status changes', () => {
  it('stops an ADMIN from disabling a SUPER_ADMIN, or themselves', async () => {
    const { agent: admin, user: adminUser } = await createUserWithRole('ADMIN');
    const { user: superUser } = await createUserWithRole('SUPER_ADMIN');

    const res = await admin.patch(`/api/admin/users/${superUser._id}/status`).send({ isActive: false });
    expect(res.status).toBe(403);
    const self = await admin.patch(`/api/admin/users/${adminUser._id}/status`).send({ isActive: false });
    expect(self.status).toBe(400);
  });

  it('lets a SUPER_ADMIN disable an ADMIN, and an ADMIN still disable a customer', async () => {
    const { agent: superAdmin } = await createUserWithRole('SUPER_ADMIN');
    const { agent: admin, user: adminUser } = await createUserWithRole('ADMIN');
    const customerEmail = uniqueEmail('rb-victim');
    await registerAndLogin({ name: 'V', email: customerEmail, role: 'CUSTOMER' });
    const User = require('../src/models/User');
    const customer = await User.findOne({ email: customerEmail });

    expect((await admin.patch(`/api/admin/users/${customer._id}/status`).send({ isActive: false })).status).toBe(200);
    expect((await superAdmin.patch(`/api/admin/users/${adminUser._id}/status`).send({ isActive: false })).status).toBe(200);
  });
});
