require('./setup');
const { registerAndLogin, uniqueEmail } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');

describe('Restaurant owner dashboard', () => {
  async function setupAndDeliverOneOrder(owner, customer) {
    const res = await owner.post('/api/restaurants').send({
      name: `Dash Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 50,
    });
    const restaurant = res.body.data.restaurant;
    await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
    const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
    const foodRes = await owner.post('/api/foods').send({
      restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Dash Item', price: 100, isVeg: true,
    });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
    const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    for (const status of ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered']) {
      await owner.patch(`/api/orders/${orderRes.body.data.order._id}/status`).send({ status });
    }
    return restaurant;
  }

  it('blocks a different owner and a customer from viewing the dashboard', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('dash-owner'), role: 'RESTAURANT_OWNER' });
    const otherOwner = await registerAndLogin({ name: 'Other', email: uniqueEmail('dash-other'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('dash-cust'), role: 'CUSTOMER' });
    const res = await owner.post('/api/restaurants').send({
      name: 'Dash Only', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    const restaurantId = res.body.data.restaurant._id;

    expect((await otherOwner.get(`/api/restaurants/${restaurantId}/dashboard`)).status).toBe(403);
    expect((await customer.get(`/api/restaurants/${restaurantId}/dashboard`)).status).toBe(403);
  });

  it('reports correct stats and revenue (delivered orders only) after a delivered order', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('dash-owner2'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('dash-cust2'), role: 'CUSTOMER' });
    const restaurant = await setupAndDeliverOneOrder(owner, customer);

    const res = await owner.get(`/api/restaurants/${restaurant._id}/dashboard`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalOrders).toBe(1);
    expect(res.body.data.deliveredOrders).toBe(1);
    expect(res.body.data.pendingOrders).toBe(0);
    expect(res.body.data.revenue).toBeCloseTo(115, 2); // 100 subtotal + 10 delivery + 5 tax
    expect(res.body.data.todayOrders).toBe(1); // owner dashboard has no last7Days series — that's admin-only (Phase 10)
  });

  it("scopes the owner's order list to a specific restaurant they own, and rejects one they don't", async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('dash-owner3'), role: 'RESTAURANT_OWNER' });
    const otherOwner = await registerAndLogin({ name: 'Other', email: uniqueEmail('dash-other2'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('dash-cust3'), role: 'CUSTOMER' });
    const restaurant = await setupAndDeliverOneOrder(owner, customer);

    const scoped = await owner.get('/api/orders').query({ restaurant: restaurant._id });
    expect(scoped.body.data.orders).toHaveLength(1);

    const forbidden = await otherOwner.get('/api/orders').query({ restaurant: restaurant._id });
    expect(forbidden.status).toBe(403);
  });
});
