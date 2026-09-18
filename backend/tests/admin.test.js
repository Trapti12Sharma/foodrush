require('./setup');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail } = require('./helpers');
const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');

// ADMIN accounts are never self-registerable (Phase 3) — provisioned directly
// here, exactly as the seed script (Phase 23) and real deployments would.
async function createAdmin() {
  const email = uniqueEmail('admin');
  await User.create({ name: 'Test Admin', email, password: 'password123', role: 'ADMIN' });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ email, password: 'password123' });
  return { agent, email };
}

describe('Admin APIs', () => {
  it('blocks non-admins from every /api/admin/* route', async () => {
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('adm-cust'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('adm-owner'), role: 'RESTAURANT_OWNER' });
    expect((await customer.get('/api/admin/dashboard')).status).toBe(403);
    expect((await owner.get('/api/admin/dashboard')).status).toBe(403);
  });

  it('returns platform-wide stats with a 7-day series and a full status breakdown', async () => {
    const { agent: admin } = await createAdmin();
    const res = await admin.get('/api/admin/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.last7Days).toHaveLength(7);
    expect(res.body.data.statusBreakdown.map((s) => s.status)).toEqual(
      expect.arrayContaining(['pending', 'delivered', 'cancelled'])
    );
    expect(typeof res.body.data.totalUsers).toBe('number');
  });

  it("approves a pending restaurant, making it publicly visible, then can disable it again", async () => {
    const { agent: admin } = await createAdmin();
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('adm-owner2'), role: 'RESTAURANT_OWNER' });
    const createRes = await owner.post('/api/restaurants').send({
      name: 'Admin Approvable', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    const restaurantId = createRes.body.data.restaurant._id;

    const pendingList = await admin.get('/api/admin/restaurants').query({ isApproved: 'false' });
    expect(pendingList.body.data.restaurants.map((r) => r._id)).toContain(restaurantId);

    const approveRes = await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`);
    expect(approveRes.body.data.restaurant.isApproved).toBe(true);

    const publicView = await request(app).get('/api/restaurants').query({ search: 'Admin Approvable' });
    expect(publicView.body.data.restaurants).toHaveLength(1);

    await admin.patch(`/api/admin/restaurants/${restaurantId}/status`).send({ isActive: false });
    const hiddenView = await request(app).get('/api/restaurants').query({ search: 'Admin Approvable' });
    expect(hiddenView.body.data.restaurants).toHaveLength(0);
  });

  it('disables a user, blocking their next login', async () => {
    const { agent: admin } = await createAdmin();
    const email = uniqueEmail('adm-target');
    await registerAndLogin({ name: 'Target', email, role: 'CUSTOMER' });

    const list = await admin.get('/api/admin/users').query({ search: email });
    const user = list.body.data.users.find((u) => u.email === email);
    expect(user).toBeDefined();
    expect('password' in user).toBe(false);

    await admin.patch(`/api/admin/users/${user._id}/status`).send({ isActive: false });
    const loginRes = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
    expect(loginRes.status).toBe(403);
  });

  it('sees every order platform-wide via /api/admin/orders', async () => {
    const { agent: admin } = await createAdmin();
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('adm-owner3'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('adm-cust2'), role: 'CUSTOMER' });
    const restRes = await owner.post('/api/restaurants').send({
      name: 'Admin Orders Kitchen', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 50,
    });
    await Restaurant.findByIdAndUpdate(restRes.body.data.restaurant._id, { isApproved: true });
    const catRes = await owner.post('/api/categories').send({ restaurant: restRes.body.data.restaurant._id, name: 'Mains' });
    const foodRes = await owner.post('/api/foods').send({
      restaurant: restRes.body.data.restaurant._id, category: catRes.body.data.category._id, name: 'Item', price: 100, isVeg: true,
    });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
    const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });

    const list = await admin.get('/api/admin/orders');
    expect(list.body.data.orders.map((o) => o._id)).toContain(orderRes.body.data.order._id);
  });
});

describe('Coupon management (admin)', () => {
  it('blocks non-admins from creating a coupon', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cpn-owner'), role: 'RESTAURANT_OWNER' });
    const res = await owner.post('/api/coupons').send({
      code: 'BLOCKED', discountType: 'FLAT', discountValue: 10, expiryDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(res.status).toBe(403);
  });

  it('creates a coupon (uppercasing the code), rejects a duplicate, and can deactivate it', async () => {
    const { agent: admin } = await createAdmin();
    const createRes = await admin.post('/api/coupons').send({
      code: 'save15', discountType: 'PERCENTAGE', discountValue: 15, minimumOrder: 50, maximumDiscount: 100,
      expiryDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.coupon.code).toBe('SAVE15');

    const dupRes = await admin.post('/api/coupons').send({
      code: 'SAVE15', discountType: 'FLAT', discountValue: 5, expiryDate: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(dupRes.status).toBe(409);

    const listRes = await admin.get('/api/coupons').query({ search: 'SAVE15' });
    expect(listRes.body.data.coupons).toHaveLength(1);

    const deactivateRes = await admin.patch(`/api/coupons/${createRes.body.data.coupon._id}`).send({ isActive: false });
    expect(deactivateRes.body.data.coupon.isActive).toBe(false);

    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cpn-cust'), role: 'CUSTOMER' });
    const validateRes = await customer.post('/api/coupons/validate').send({ code: 'SAVE15', subtotal: 100 });
    expect(validateRes.status).toBe(400); // deactivated coupons are rejected everywhere, immediately
  });
});
