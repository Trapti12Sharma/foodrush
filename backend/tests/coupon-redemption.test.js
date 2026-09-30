require('./setup');
const { registerAndLogin, uniqueEmail, setupOrderable } = require('./helpers');
const Coupon = require('../src/models/Coupon');
const Order = require('../src/models/Order');

const future = () => new Date(Date.now() + 86400000);

async function customerWithCart(food, couponCode) {
  const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cr-cust'), role: 'CUSTOMER' });
  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  if (couponCode) await customer.post('/api/cart/coupon').send({ code: couponCode }).expect(200);
  return { customer, addressId: addr.body.data.address._id };
}

const placeOrder = ({ customer, addressId }) => customer.post('/api/orders').send({ addressId, paymentMethod: 'COD' });

describe('coupon redemption', () => {
  it('lets exactly one of two simultaneous checkouts use the last remaining coupon use', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cr-owner'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    await Coupon.create({ code: 'LASTONE', discountType: 'FLAT', discountValue: 10, minimumOrder: 0, expiryDate: future(), usageLimit: 1 });

    const a = await customerWithCart(food, 'LASTONE');
    const b = await customerWithCart(food, 'LASTONE');
    const [resA, resB] = await Promise.all([placeOrder(a), placeOrder(b)]);

    expect([resA.status, resB.status].sort()).toEqual([201, 409]);
    const coupon = await Coupon.findOne({ code: 'LASTONE' });
    expect(coupon.usedCount).toBe(1); // never exceeds the limit
    expect(await Order.countDocuments({ 'coupon.code': 'LASTONE' })).toBe(1);
  });

  it('rejects the order (instead of silently dropping the discount) when the coupon stopped being valid', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cr-owner2'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    await Coupon.create({ code: 'GONE', discountType: 'FLAT', discountValue: 10, minimumOrder: 0, expiryDate: future() });
    const ctx = await customerWithCart(food, 'GONE');

    await Coupon.updateOne({ code: 'GONE' }, { isActive: false }); // e.g. an admin disabled it after it was applied

    const res = await placeOrder(ctx);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/GONE.*no longer/i);
    expect(await Order.countDocuments({})).toBe(0);
    expect((await Coupon.findOne({ code: 'GONE' })).usedCount).toBe(0);
  });

  it('records the discount and one use when the coupon is still valid', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cr-owner3'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner, { price: 100, deliveryFee: 10 });
    await Coupon.create({ code: 'OK20', discountType: 'FLAT', discountValue: 20, minimumOrder: 0, expiryDate: future() });
    const ctx = await customerWithCart(food, 'OK20');

    const res = await placeOrder(ctx);
    expect(res.status).toBe(201);
    const { order } = res.body.data;
    expect(order.discount).toBe(20);
    expect(order.coupon.code).toBe('OK20');
    expect(order.totalAmount).toBe(95); // 100 + 10 delivery + 5 tax - 20
    expect((await Coupon.findOne({ code: 'OK20' })).usedCount).toBe(1);
  });

  it('hands the coupon use back when the order could not be created', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cr-owner4'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    await Coupon.create({ code: 'REFUND1', discountType: 'FLAT', discountValue: 10, minimumOrder: 0, expiryDate: future(), usageLimit: 1 });
    const ctx = await customerWithCart(food, 'REFUND1');

    const spy = jest.spyOn(Order, 'create').mockRejectedValueOnce(new Error('write failed'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await placeOrder(ctx);
    spy.mockRestore();
    errSpy.mockRestore();

    expect(failed.status).toBe(500);
    expect((await Coupon.findOne({ code: 'REFUND1' })).usedCount).toBe(0);

    const retry = await placeOrder(ctx); // the single use is still available
    expect(retry.status).toBe(201);
  });

  it('keeps an unlimited coupon (usageLimit null) redeemable repeatedly', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cr-owner5'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    await Coupon.create({ code: 'FOREVER', discountType: 'FLAT', discountValue: 5, minimumOrder: 0, expiryDate: future() });

    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const ctx = await customerWithCart(food, 'FOREVER');
      // eslint-disable-next-line no-await-in-loop
      expect((await placeOrder(ctx)).status).toBe(201);
    }
    expect((await Coupon.findOne({ code: 'FOREVER' })).usedCount).toBe(3);
  });
});
