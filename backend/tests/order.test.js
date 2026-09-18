require('./setup');
const crypto = require('crypto');
const { registerAndLogin, uniqueEmail } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Order = require('../src/models/Order');
const Address = require('../src/models/Address');

async function setupOrderable(owner, opts = {}) {
  const res = await owner.post('/api/restaurants').send({
    name: `Order Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune',
    deliveryTime: 20, deliveryFee: 10, minimumOrder: opts.minimumOrder ?? 50,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Order Item', price: opts.price ?? 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

describe('Addresses', () => {
  it('makes the first address default automatically, and only one address stays default', async () => {
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('addr-cust'), role: 'CUSTOMER' });
    const first = await customer.post('/api/addresses').send({ addressLine: '1 Home Rd', city: 'Pune', pincode: '411001' });
    expect(first.body.data.address.isDefault).toBe(true);

    const second = await customer.post('/api/addresses').send({ addressLine: '2 Work Rd', city: 'Pune', pincode: '411002', isDefault: true });
    const list = await customer.get('/api/addresses');
    const defaults = list.body.data.addresses.filter((a) => a.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]._id).toBe(second.body.data.address._id);
  });
});

describe('Checkout & Orders', () => {
  it('rejects placing an order with an empty cart', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('ord-owner'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('ord-cust'), role: 'CUSTOMER' });
    await setupOrderable(owner);
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    const res = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    expect(res.status).toBe(400);
  });

  it('rejects an order below the restaurant minimum', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('ord-owner2'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('ord-cust2'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner, { price: 10, minimumOrder: 100 });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const res = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    expect(res.status).toBe(400);
  });

  it('rejects ordering from a closed restaurant', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('ord-owner3'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('ord-cust3'), role: 'CUSTOMER' });
    const { restaurant, food } = await setupOrderable(owner);
    await owner.put(`/api/restaurants/${restaurant._id}`).send({ isOpen: false });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const res = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    expect(res.status).toBe(400);
  });

  it("rejects using another customer's address id", async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('ord-owner4'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('ord-cust4'), role: 'CUSTOMER' });
    const stranger = await registerAndLogin({ name: 'Stranger', email: uniqueEmail('ord-stranger'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner);
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await stranger.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const res = await stranger.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    expect(res.status).toBe(400);
  });

  it('places a valid order, applies a coupon, and clears the cart afterward', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('ord-owner5'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('ord-cust5'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner, { price: 200 });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });

    const Coupon = require('../src/models/Coupon');
    await Coupon.create({
      code: 'TESTCOUPON', discountType: 'FLAT', discountValue: 20, minimumOrder: 50,
      expiryDate: new Date(Date.now() + 86400000), isActive: true,
    });

    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const applyRes = await customer.post('/api/cart/coupon').send({ code: 'testcoupon' });
    expect(applyRes.body.data.cart.discount).toBe(20);

    const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.data.order.discount).toBe(20);
    expect(orderRes.body.data.order.coupon.code).toBe('TESTCOUPON');

    const cartRes = await customer.get('/api/cart');
    expect(cartRes.body.data.cart.items).toHaveLength(0);
  });

  it('rejects an invalid coupon code', async () => {
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('coupon-cust'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('coupon-owner'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const res = await customer.post('/api/cart/coupon').send({ code: 'DOESNOTEXIST' });
    expect(res.status).toBe(400);
  });

  describe('Order status transitions', () => {
    async function placeOrder(owner, customer) {
      const { restaurant, food } = await setupOrderable(owner);
      const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
      const res = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
      return { order: res.body.data.order, restaurant };
    }

    it('rejects a customer trying to update order status', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('stat-owner'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('stat-cust'), role: 'CUSTOMER' });
      const { order } = await placeOrder(owner, customer);
      const res = await customer.patch(`/api/orders/${order._id}/status`).send({ status: 'confirmed' });
      expect(res.status).toBe(403);
    });

    it('rejects an invalid status transition (pending -> delivered)', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('stat-owner2'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('stat-cust2'), role: 'CUSTOMER' });
      const { order } = await placeOrder(owner, customer);
      const res = await owner.patch(`/api/orders/${order._id}/status`).send({ status: 'delivered' });
      expect(res.status).toBe(400);
    });

    it('allows a valid transition and records it in status history', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('stat-owner3'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('stat-cust3'), role: 'CUSTOMER' });
      const { order } = await placeOrder(owner, customer);
      const res = await owner.patch(`/api/orders/${order._id}/status`).send({ status: 'confirmed' });
      expect(res.status).toBe(200);
      expect(res.body.data.order.orderStatus).toBe('confirmed');
      expect(res.body.data.order.statusHistory.map((h) => h.status)).toEqual(['pending', 'confirmed']);
    });

    it('lets a customer cancel while pending, but not once preparing', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cancel-owner'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cancel-cust'), role: 'CUSTOMER' });
      const { order: order1 } = await placeOrder(owner, customer);
      const cancelWhilePending = await customer.post(`/api/orders/${order1._id}/cancel`);
      expect(cancelWhilePending.status).toBe(200);
      expect(cancelWhilePending.body.data.order.orderStatus).toBe('cancelled');

      const { order: order2 } = await placeOrder(owner, customer);
      await owner.patch(`/api/orders/${order2._id}/status`).send({ status: 'confirmed' });
      await owner.patch(`/api/orders/${order2._id}/status`).send({ status: 'preparing' });
      const cancelWhilePreparing = await customer.post(`/api/orders/${order2._id}/cancel`);
      expect(cancelWhilePreparing.status).toBe(403);

      // A cancelled order cannot be cancelled again.
      const secondCancelAttempt = await customer.post(`/api/orders/${order1._id}/cancel`);
      expect(secondCancelAttempt.status).toBe(400);
    });

    it('hides an order from a stranger but shows it to the restaurant owner', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('view-owner'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('view-cust'), role: 'CUSTOMER' });
      const stranger = await registerAndLogin({ name: 'Stranger', email: uniqueEmail('view-stranger'), role: 'CUSTOMER' });
      const { order } = await placeOrder(owner, customer);

      expect((await stranger.get(`/api/orders/${order._id}`)).status).toBe(404);
      expect((await owner.get(`/api/orders/${order._id}`)).status).toBe(200);
      expect((await customer.get(`/api/orders/${order._id}`)).status).toBe(200);
    });
  });

  describe('Payment verification', () => {
    const FAKE_SECRET = 'jest_fake_secret';

    beforeAll(() => {
      process.env.RAZORPAY_KEY_ID = 'rzp_test_fake';
      process.env.RAZORPAY_KEY_SECRET = FAKE_SECRET;
    });

    afterAll(() => {
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
    });

    function sign(orderId, paymentId, secret) {
      return crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
    }

    it('still refuses to create an ONLINE order even with fake credentials configured (order creation is honestly not implemented)', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('pay-owner'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('pay-cust'), role: 'CUSTOMER' });
      const { food } = await setupOrderable(owner);
      const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
      const res = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'ONLINE' });
      expect(res.status).toBe(501);
    });

    it('verifies a correct signature and rejects a tampered one', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('pay-owner2'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('pay-cust2'), role: 'CUSTOMER' });
      const { restaurant, food } = await setupOrderable(owner);
      const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      const address = await Address.findById(addrRes.body.data.address._id);
      const meRes = await customer.get('/api/auth/me');
      const userId = meRes.body.data.user._id;

      const order = await Order.create({
        user: userId, restaurant: restaurant._id,
        items: [{ food: food._id, name: 'Order Item', price: 100, quantity: 1, addons: [] }],
        deliveryAddress: { addressLine: address.addressLine, city: address.city, pincode: address.pincode },
        subtotal: 100, deliveryFee: 10, tax: 5, discount: 0, totalAmount: 115,
        paymentMethod: 'ONLINE', paymentStatus: 'pending',
        orderStatus: 'pending', statusHistory: [{ status: 'pending', changedBy: userId }],
      });

      const razorpayOrderId = 'order_TEST1';
      const razorpayPaymentId = 'pay_TEST1';
      const badRes = await customer.post(`/api/orders/${order._id}/verify-payment`).send({
        razorpayOrderId, razorpayPaymentId, signature: 'a'.repeat(64),
      });
      expect(badRes.status).toBe(400);
      expect((await Order.findById(order._id)).paymentStatus).toBe('failed');

      const goodRes = await customer.post(`/api/orders/${order._id}/verify-payment`).send({
        razorpayOrderId, razorpayPaymentId, signature: sign(razorpayOrderId, razorpayPaymentId, FAKE_SECRET),
      });
      expect(goodRes.status).toBe(200);
      expect(goodRes.body.data.order.paymentStatus).toBe('paid');
      expect(goodRes.body.data.order.transactionId).toBe(razorpayPaymentId);
    });
  });
});
