require('./setup');
const { registerAndLogin, uniqueEmail } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');

async function setupDeliveredOrder(owner, customer) {
  const res = await owner.post('/api/restaurants').send({
    name: `Review Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 50,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Review Item', price: 100, isVeg: true,
  });

  const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
  const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
  const order = orderRes.body.data.order;

  for (const status of ['confirmed', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered']) {
    await owner.patch(`/api/orders/${order._id}/status`).send({ status });
  }

  return { restaurant, order };
}

describe('Reviews', () => {
  it('rejects reviewing an order before it is delivered', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rev-owner'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('rev-cust'), role: 'CUSTOMER' });
    const res = await owner.post('/api/restaurants').send({
      name: 'Undelivered', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    await Restaurant.findByIdAndUpdate(res.body.data.restaurant._id, { isApproved: true });
    const catRes = await owner.post('/api/categories').send({ restaurant: res.body.data.restaurant._id, name: 'Mains' });
    const foodRes = await owner.post('/api/foods').send({
      restaurant: res.body.data.restaurant._id, category: catRes.body.data.category._id, name: 'Item', price: 100, isVeg: true,
    });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
    const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });

    const reviewRes = await customer.post('/api/reviews').send({
      restaurant: res.body.data.restaurant._id, order: orderRes.body.data.order._id, rating: 5,
    });
    expect(reviewRes.status).toBe(400);
  });

  it('accepts a review on a delivered order and updates the restaurant rating', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rev-owner2'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('rev-cust2'), role: 'CUSTOMER' });
    const { restaurant, order } = await setupDeliveredOrder(owner, customer);

    const res = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 4, comment: 'Good' });
    expect(res.status).toBe(201);

    const restaurantRes = await customer.get(`/api/restaurants/${restaurant._id}`);
    expect(restaurantRes.body.data.restaurant.rating).toBe(4);
    expect(restaurantRes.body.data.restaurant.totalReviews).toBe(1);
  });

  it('rejects a second review for the same order', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rev-owner3'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('rev-cust3'), role: 'CUSTOMER' });
    const { restaurant, order } = await setupDeliveredOrder(owner, customer);
    await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 4 });
    const res = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 2 });
    expect(res.status).toBe(409);
  });

  it("rejects editing someone else's review", async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rev-owner4'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('rev-cust4'), role: 'CUSTOMER' });
    const stranger = await registerAndLogin({ name: 'Stranger', email: uniqueEmail('rev-stranger'), role: 'CUSTOMER' });
    const { restaurant, order } = await setupDeliveredOrder(owner, customer);
    const reviewRes = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 4 });
    const res = await stranger.put(`/api/reviews/${reviewRes.body.data.review._id}`).send({ rating: 1 });
    expect(res.status).toBe(403);
  });

  it('resets the rating to 0 after the only review is deleted', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rev-owner5'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('rev-cust5'), role: 'CUSTOMER' });
    const { restaurant, order } = await setupDeliveredOrder(owner, customer);
    const reviewRes = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 5 });
    await customer.delete(`/api/reviews/${reviewRes.body.data.review._id}`);
    const restaurantRes = await customer.get(`/api/restaurants/${restaurant._id}`);
    expect(restaurantRes.body.data.restaurant.rating).toBe(0);
    expect(restaurantRes.body.data.restaurant.totalReviews).toBe(0);
  });
});

describe('Favorites', () => {
  it('is idempotent — favoriting twice does not create a duplicate', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('fav-owner'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('fav-cust'), role: 'CUSTOMER' });
    const res = await owner.post('/api/restaurants').send({
      name: 'Fav Place', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    const restaurantId = res.body.data.restaurant._id;
    await Restaurant.findByIdAndUpdate(restaurantId, { isApproved: true });

    await customer.post(`/api/favorites/${restaurantId}`);
    await customer.post(`/api/favorites/${restaurantId}`);
    const list = await customer.get('/api/favorites');
    expect(list.body.data.restaurants).toHaveLength(1);

    await customer.delete(`/api/favorites/${restaurantId}`);
    const afterRemove = await customer.get('/api/favorites');
    expect(afterRemove.body.data.restaurants).toHaveLength(0);
  });
});
