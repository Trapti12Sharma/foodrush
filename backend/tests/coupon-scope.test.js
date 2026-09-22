require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const CouponUsage = require('../src/models/CouponUsage');
const Restaurant = require('../src/models/Restaurant');

const future = () => new Date(Date.now() + 86400000).toISOString();

async function restaurantIn(city, price = 100) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('scope-o'), role: 'RESTAURANT_OWNER' });
  const { restaurant, food } = await setupOrderable(owner, { price });
  await Restaurant.findByIdAndUpdate(restaurant._id, { city });
  return { owner, restaurant: { ...restaurant, city }, food };
}

const addAndOrder = async (customer, food, code) => {
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  if (code) await customer.post('/api/cart/coupon').send({ code });
  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  return customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
};

describe('coupon admin fields: create/update', () => {
  it('creates a coupon with perUserLimit, restaurant scope and fundedBy', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { restaurant } = await restaurantIn('Pune');
    const res = await admin.post('/api/coupons').send({
      code: 'SCOPED1', discountType: 'FLAT', discountValue: 10, expiryDate: future(),
      perUserLimit: 2, restaurant: restaurant._id, fundedBy: 'RESTAURANT',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.coupon).toMatchObject({ perUserLimit: 2, fundedBy: 'RESTAURANT' });
    expect(res.body.data.coupon.restaurant).toBe(String(restaurant._id));
    expect(res.body.data.coupon.city).toBeNull(); // restaurant scope clears city
  });

  it('setting a restaurant on update clears any previously-set city', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { restaurant } = await restaurantIn('Pune');
    const created = await admin.post('/api/coupons').send({ code: 'CITY1', discountType: 'FLAT', discountValue: 10, expiryDate: future(), city: 'Pune' });
    expect(created.body.data.coupon.city).toBe('Pune');
    const updated = await admin.patch(`/api/coupons/${created.body.data.coupon._id}`).send({ restaurant: restaurant._id });
    expect(updated.body.data.coupon.city).toBeNull();
    expect(updated.body.data.coupon.restaurant).toBe(String(restaurant._id));
  });

  it('validates the new fields', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const base = { code: 'BADSCOPE', discountType: 'FLAT', discountValue: 10, expiryDate: future() };
    expect((await admin.post('/api/coupons').send({ ...base, perUserLimit: 0 })).status).toBe(422);
    expect((await admin.post('/api/coupons').send({ ...base, restaurant: 'not-an-id' })).status).toBe(422);
    expect((await admin.post('/api/coupons').send({ ...base, fundedBy: 'NOBODY' })).status).toBe(422);
  });
});

describe('restaurant-scoped coupons', () => {
  it('applies only at the scoped restaurant, and is rejected elsewhere', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { food: rightFood, restaurant: rightRestaurant } = await restaurantIn('Pune', 200);
    const { food: wrongFood } = await restaurantIn('Pune', 200);
    await admin.post('/api/coupons').send({ code: 'ONLYHERE', discountType: 'FLAT', discountValue: 30, expiryDate: future(), restaurant: rightRestaurant._id });

    const wrongCustomer = await registerAndLogin({ name: 'C', email: uniqueEmail('scope-wrong'), role: 'CUSTOMER' });
    await wrongCustomer.post('/api/cart/items').send({ foodId: wrongFood._id, quantity: 1 });
    const rejected = await wrongCustomer.post('/api/cart/coupon').send({ code: 'ONLYHERE' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toMatch(/not valid for this restaurant/i);

    const rightCustomer = await registerAndLogin({ name: 'C', email: uniqueEmail('scope-right'), role: 'CUSTOMER' });
    const order = await addAndOrder(rightCustomer, rightFood, 'ONLYHERE');
    expect(order.status).toBe(201);
    expect(order.body.data.order.discount).toBe(30);
  });
});

describe('city-scoped coupons', () => {
  it('applies only to restaurants in the scoped city', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.post('/api/coupons').send({ code: 'NOIDAONLY', discountType: 'FLAT', discountValue: 15, expiryDate: future(), city: 'Noida' });
    const { food: noidaFood } = await restaurantIn('Noida', 200);
    const { food: puneFood } = await restaurantIn('Pune', 200);

    const puneCustomer = await registerAndLogin({ name: 'C', email: uniqueEmail('city-pune'), role: 'CUSTOMER' });
    await puneCustomer.post('/api/cart/items').send({ foodId: puneFood._id, quantity: 1 });
    const rejected = await puneCustomer.post('/api/cart/coupon').send({ code: 'NOIDAONLY' });
    expect(rejected.status).toBe(400);
    expect(rejected.body.message).toMatch(/only valid in Noida/i);

    const noidaCustomer = await registerAndLogin({ name: 'C', email: uniqueEmail('city-noida'), role: 'CUSTOMER' });
    const order = await addAndOrder(noidaCustomer, noidaFood, 'NOIDAONLY');
    expect(order.status).toBe(201);
    expect(order.body.data.order.discount).toBe(15);
  });

  it('city match is case-insensitive', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.post('/api/coupons').send({ code: 'CASECHECK', discountType: 'FLAT', discountValue: 5, expiryDate: future(), city: 'NOIDA' });
    const { food } = await restaurantIn('noida', 100);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('city-case'), role: 'CUSTOMER' });
    const order = await addAndOrder(customer, food, 'CASECHECK');
    expect(order.status).toBe(201);
  });
});

describe('perUserLimit', () => {
  it('allows exactly N uses per customer, then blocks that customer while others are unaffected', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.post('/api/coupons').send({ code: 'TWOUSES', discountType: 'FLAT', discountValue: 10, expiryDate: future(), perUserLimit: 2 });
    const { food } = await restaurantIn('Pune', 100);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('peruser-a'), role: 'CUSTOMER' });

    expect((await addAndOrder(customer, food, 'TWOUSES')).status).toBe(201);
    expect((await addAndOrder(customer, food, 'TWOUSES')).status).toBe(201);

    // Third attempt: applying the coupon itself is rejected (checked directly — addAndOrder's
    // helper would otherwise silently place the order coupon-less and still return 201).
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const blockedApply = await customer.post('/api/cart/coupon').send({ code: 'TWOUSES' });
    expect(blockedApply.status).toBe(400);
    expect(blockedApply.body.message).toMatch(/maximum number of times/i);
    await customer.delete('/api/cart');

    // A different customer starts with a fresh count.
    const other = await registerAndLogin({ name: 'C2', email: uniqueEmail('peruser-b'), role: 'CUSTOMER' });
    expect((await addAndOrder(other, food, 'TWOUSES')).status).toBe(201);

    expect(await CouponUsage.countDocuments({})).toBe(3);
  });

  it('records a CouponUsage row per order, referencing the right coupon/user/order', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const created = await admin.post('/api/coupons').send({ code: 'TRACKME', discountType: 'FLAT', discountValue: 10, expiryDate: future() });
    const { food } = await restaurantIn('Pune', 100);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('track-c'), role: 'CUSTOMER' });
    const order = await addAndOrder(customer, food, 'TRACKME');
    expect(order.status).toBe(201);

    const usage = await CouponUsage.findOne({ order: order.body.data.order._id });
    expect(usage.discountAmount).toBe(10);
    expect(String(usage.coupon)).toBe(created.body.data.coupon._id);
    expect(String(usage.user)).toBe((await customer.get('/api/auth/me')).body.data.user._id);
  });

  it('an unlimited coupon (perUserLimit null) has no per-user cap', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.post('/api/coupons').send({ code: 'NOLIMIT', discountType: 'FLAT', discountValue: 5, expiryDate: future() });
    const { food } = await restaurantIn('Pune', 100);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('nolimit-c'), role: 'CUSTOMER' });
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      expect((await addAndOrder(customer, food, 'NOLIMIT')).status).toBe(201);
    }
  });
});

describe('/api/coupons/validate honours scope with an authenticated user', () => {
  it('needs restaurantId to validate a restaurant-scoped coupon', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { restaurant } = await restaurantIn('Pune');
    await admin.post('/api/coupons').send({ code: 'CHECKSCOPE', discountType: 'FLAT', discountValue: 10, expiryDate: future(), restaurant: restaurant._id });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('validate-c'), role: 'CUSTOMER' });

    const withoutContext = await customer.post('/api/coupons/validate').send({ code: 'CHECKSCOPE', subtotal: 200 });
    expect(withoutContext.status).toBe(400);
    const withContext = await customer.post('/api/coupons/validate').send({ code: 'CHECKSCOPE', subtotal: 200, restaurantId: restaurant._id });
    expect(withContext.status).toBe(200);
  });
});

describe('does not break plain, unscoped coupons (regression)', () => {
  it('an unscoped coupon still works everywhere, for everyone, as before', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.post('/api/coupons').send({ code: 'PLAINOLD', discountType: 'PERCENTAGE', discountValue: 10, expiryDate: future() });
    const { food: foodA } = await restaurantIn('Pune', 100);
    const { food: foodB } = await restaurantIn('Mumbai', 100);
    const c1 = await registerAndLogin({ name: 'C1', email: uniqueEmail('plain-1'), role: 'CUSTOMER' });
    const c2 = await registerAndLogin({ name: 'C2', email: uniqueEmail('plain-2'), role: 'CUSTOMER' });
    expect((await addAndOrder(c1, foodA, 'PLAINOLD')).status).toBe(201);
    expect((await addAndOrder(c2, foodB, 'PLAINOLD')).status).toBe(201);
  });
});
