require('./setup');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');

async function setupRestaurantWithFood(owner, { price = 100, deliveryFee = 20, addons = [] } = {}) {
  const res = await owner.post('/api/restaurants').send({
    name: `Cart Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Cart Item', price, isVeg: true, addons,
  });
  return { restaurant, food: foodRes.body.data.food };
}

describe('Cart', () => {
  it('rejects an unauthenticated cart request', async () => {
    const res = await request(app).get('/api/cart');
    expect(res.status).toBe(401);
  });

  it('rejects an invalid quantity', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cart-owner'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cart-cust'), role: 'CUSTOMER' });
    const { food } = await setupRestaurantWithFood(owner);
    const res = await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 0 });
    expect(res.status).toBe(422);
  });

  it('rejects adding a currently-unavailable food item', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cart-owner2'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cart-cust2'), role: 'CUSTOMER' });
    const { food } = await setupRestaurantWithFood(owner);
    await owner.put(`/api/foods/${food._id}`).send({ isAvailable: false });
    const res = await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    expect(res.status).toBe(400);
  });

  it('computes subtotal, delivery fee, and tax correctly', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cart-owner3'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cart-cust3'), role: 'CUSTOMER' });
    const { food } = await setupRestaurantWithFood(owner, { price: 100, deliveryFee: 20 });

    const res = await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 2 });
    expect(res.body.data.cart.subtotal).toBe(200);
    expect(res.body.data.cart.deliveryFee).toBe(20);
    expect(res.body.data.cart.tax).toBeCloseTo(10, 2); // 5% of 200
    expect(res.body.data.cart.total).toBeCloseTo(230, 2);
  });

  it('rejects mixing items from two different restaurants, with a structured conflict payload', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cart-owner4'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cart-cust4'), role: 'CUSTOMER' });
    const { food: foodA } = await setupRestaurantWithFood(owner);
    const { food: foodB } = await setupRestaurantWithFood(owner);

    await customer.post('/api/cart/items').send({ foodId: foodA._id, quantity: 1 });
    const res = await customer.post('/api/cart/items').send({ foodId: foodB._id, quantity: 1 });
    expect(res.status).toBe(409);
    expect(res.body.data.existingRestaurantName).toBeDefined();
  });

  it('self-heals: an item disabled after being added disappears from the cart on next read', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cart-owner5'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cart-cust5'), role: 'CUSTOMER' });
    const { food } = await setupRestaurantWithFood(owner);

    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    await owner.put(`/api/foods/${food._id}`).send({ isAvailable: false });

    const res = await customer.get('/api/cart');
    expect(res.body.data.cart.items).toHaveLength(0);
    expect(res.body.data.cart.restaurant).toBeNull();
    expect(res.body.data.cart.total).toBe(0);
  });

  it('clears the cart entirely on request', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('cart-owner6'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('cart-cust6'), role: 'CUSTOMER' });
    const { food } = await setupRestaurantWithFood(owner);
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });

    const res = await customer.delete('/api/cart');
    expect(res.body.data.cart.items).toHaveLength(0);
    expect(res.body.data.cart.total).toBe(0);
  });
});
