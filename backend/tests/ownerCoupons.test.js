require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const Coupon = require('../src/models/Coupon');

const future = () => new Date(Date.now() + 86400000).toISOString();
const past = () => new Date(Date.now() - 86400000).toISOString();

const basePayload = (overrides = {}) => ({
  code: `OWN${Date.now()}${Math.floor(Math.random() * 1000)}`,
  discountType: 'FLAT',
  discountValue: 25,
  expiryDate: future(),
  ...overrides,
});

describe('restaurant-owner coupon management', () => {
  it('lets an owner create a coupon for their own restaurant, forced to restaurant-funded scope', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('oc-create'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);

    // Even though the client tries to claim a different scope, the server must
    // ignore all of it — this is the actual security property being tested, not
    // just "can an owner create a coupon".
    const res = await owner.post(`/api/restaurants/${restaurant._id}/coupons`).send(
      basePayload({ restaurant: '000000000000000000000000', city: 'Nowhereville', fundedBy: 'PLATFORM' })
    );
    expect(res.status).toBe(201);
    expect(res.body.data.coupon.restaurant).toBe(String(restaurant._id));
    expect(res.body.data.coupon.city).toBeNull();
    expect(res.body.data.coupon.fundedBy).toBe('RESTAURANT');
  });

  it('a different owner cannot create a coupon for someone else\'s restaurant', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('oc-stranger-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('oc-stranger-s'), role: 'RESTAURANT_OWNER' });

    const res = await stranger.post(`/api/restaurants/${restaurant._id}/coupons`).send(basePayload());
    expect(res.status).toBe(403);
  });

  it('a customer cannot create a restaurant coupon, and an unauthenticated caller gets 401', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('oc-cust-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('oc-cust-c'), role: 'CUSTOMER' });
    expect((await customer.post(`/api/restaurants/${restaurant._id}/coupons`).send(basePayload())).status).toBe(403);

    const { app } = require('./helpers');
    const request = require('supertest');
    expect((await request(app).post(`/api/restaurants/${restaurant._id}/coupons`).send(basePayload())).status).toBe(401);
  });

  it('rejects an expiry date in the past', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('oc-pastexp'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const res = await owner.post(`/api/restaurants/${restaurant._id}/coupons`).send(basePayload({ expiryDate: past() }));
    expect(res.status).toBe(422);
  });

  it('rejects a duplicate code, even across different restaurants', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('oc-dup-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant: r1 } = await setupOrderable(owner);
    const { restaurant: r2 } = await setupOrderable(owner);
    const code = `DUPCODE${Date.now()}`;
    expect((await owner.post(`/api/restaurants/${r1._id}/coupons`).send(basePayload({ code }))).status).toBe(201);
    const second = await owner.post(`/api/restaurants/${r2._id}/coupons`).send(basePayload({ code }));
    expect(second.status).toBe(409);
  });

  it('lists only this restaurant\'s coupons, and an admin can list them too', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('oc-list-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant: mine } = await setupOrderable(owner);
    const { restaurant: other } = await setupOrderable(owner);
    await owner.post(`/api/restaurants/${mine._id}/coupons`).send(basePayload());
    await owner.post(`/api/restaurants/${other._id}/coupons`).send(basePayload());

    const list = await owner.get(`/api/restaurants/${mine._id}/coupons`);
    expect(list.status).toBe(200);
    expect(list.body.data.coupons).toHaveLength(1);

    const { agent: admin } = await createUserWithRole('ADMIN');
    const adminList = await admin.get(`/api/restaurants/${mine._id}/coupons`);
    expect(adminList.status).toBe(200);
    expect(adminList.body.data.coupons).toHaveLength(1);
  });

  it('lets an owner update their own coupon, but not re-scope it, and 404s on another restaurant\'s coupon id', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('oc-update-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant: mine } = await setupOrderable(owner);
    const { restaurant: other } = await setupOrderable(owner);
    const created = await owner.post(`/api/restaurants/${mine._id}/coupons`).send(basePayload({ discountValue: 10 }));
    const couponId = created.body.data.coupon._id;

    const updated = await owner
      .patch(`/api/restaurants/${mine._id}/coupons/${couponId}`)
      .send({ discountValue: 20, restaurant: String(other._id), city: 'Hijack' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.coupon.discountValue).toBe(20);
    expect(updated.body.data.coupon.restaurant).toBe(String(mine._id)); // unchanged despite the attempt
    expect(updated.body.data.coupon.city).toBeNull();

    const wrongRestaurant = await owner.patch(`/api/restaurants/${other._id}/coupons/${couponId}`).send({ discountValue: 30 });
    expect(wrongRestaurant.status).toBe(404);
  });
});

describe('customer-facing coupon discovery (GET /coupons/available)', () => {
  it('shows a restaurant-owner-created coupon, and lets the customer actually apply it and have the total recalculated', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('avail-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant, food } = await setupOrderable(owner, { price: 200 });
    await owner.post(`/api/restaurants/${restaurant._id}/coupons`).send(
      basePayload({ code: 'OWNEROFFER', discountType: 'FLAT', discountValue: 40 })
    );

    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('avail-c'), role: 'CUSTOMER' });
    const available = await customer.get('/api/coupons/available').query({ restaurantId: restaurant._id });
    expect(available.status).toBe(200);
    expect(available.body.data.coupons.map((c) => c.code)).toContain('OWNEROFFER');

    // Apply it exactly the way Checkout.jsx does, and confirm the math.
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const applied = await customer.post('/api/cart/coupon').send({ code: 'OWNEROFFER' });
    expect(applied.status).toBe(200);
    expect(applied.body.data.cart.discount).toBe(40);
    expect(applied.body.data.cart.total).toBe(applied.body.data.cart.subtotal + applied.body.data.cart.deliveryFee + applied.body.data.cart.tax - 40);
  });

  it('does not show a different restaurant\'s coupon', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('avail-leak-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant: mine } = await setupOrderable(owner);
    const { restaurant: other } = await setupOrderable(owner);
    await owner.post(`/api/restaurants/${mine._id}/coupons`).send(basePayload({ code: 'MINEONLY' }));

    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('avail-leak-c'), role: 'CUSTOMER' });
    const res = await customer.get('/api/coupons/available').query({ restaurantId: other._id });
    expect(res.body.data.coupons.map((c) => c.code)).not.toContain('MINEONLY');
  });

  it('stops showing a coupon once this customer has used up their perUserLimit, without affecting other customers', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('avail-limit-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant, food } = await setupOrderable(owner, { price: 100 });
    await owner.post(`/api/restaurants/${restaurant._id}/coupons`).send(basePayload({ code: 'ONEUSE', perUserLimit: 1 }));

    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('avail-limit-c'), role: 'CUSTOMER' });
    const before = await customer.get('/api/coupons/available').query({ restaurantId: restaurant._id });
    expect(before.body.data.coupons.map((c) => c.code)).toContain('ONEUSE');

    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    await customer.post('/api/cart/coupon').send({ code: 'ONEUSE' });
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });

    const after = await customer.get('/api/coupons/available').query({ restaurantId: restaurant._id });
    expect(after.body.data.coupons.map((c) => c.code)).not.toContain('ONEUSE');

    const other = await registerAndLogin({ name: 'C2', email: uniqueEmail('avail-limit-c2'), role: 'CUSTOMER' });
    const forOther = await other.get('/api/coupons/available').query({ restaurantId: restaurant._id });
    expect(forOther.body.data.coupons.map((c) => c.code)).toContain('ONEUSE');
  });

  it('excludes an expired or deactivated coupon', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('avail-exp-o'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const created = await owner.post(`/api/restaurants/${restaurant._id}/coupons`).send(basePayload({ code: 'SOONDEAD' }));
    await Coupon.findByIdAndUpdate(created.body.data.coupon._id, { expiryDate: past() });

    const created2 = await owner.post(`/api/restaurants/${restaurant._id}/coupons`).send(basePayload({ code: 'TURNEDOFF' }));
    await Coupon.findByIdAndUpdate(created2.body.data.coupon._id, { isActive: false });

    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('avail-exp-c'), role: 'CUSTOMER' });
    const res = await customer.get('/api/coupons/available').query({ restaurantId: restaurant._id });
    const codes = res.body.data.coupons.map((c) => c.code);
    expect(codes).not.toContain('SOONDEAD');
    expect(codes).not.toContain('TURNEDOFF');
  });

  it('requires restaurantId', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('avail-noid'), role: 'CUSTOMER' });
    expect((await customer.get('/api/coupons/available')).status).toBe(422);
  });
});
