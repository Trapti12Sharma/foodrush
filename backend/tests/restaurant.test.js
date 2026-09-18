require('./setup');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');

async function createApprovedRestaurant(owner, overrides = {}) {
  const res = await owner.post('/api/restaurants').send({
    name: `Test Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Indian'],
    address: { addressLine: '1 Test St' },
    city: 'Pune',
    deliveryTime: 30,
    deliveryFee: 20,
    minimumOrder: 100,
    ...overrides,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
  return restaurant;
}

describe('Restaurant APIs', () => {
  it('creates a restaurant pending approval, invisible to the public until approved', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rest-owner'), role: 'RESTAURANT_OWNER' });
    const createRes = await owner.post('/api/restaurants').send({
      name: 'Pending Place', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    expect(createRes.status).toBe(201);
    expect(createRes.body.data.restaurant.isApproved).toBe(false);

    const publicList = await request(app).get('/api/restaurants').query({ search: 'Pending Place' });
    expect(publicList.body.data.restaurants).toHaveLength(0);

    const stranger = await registerAndLogin({ name: 'Stranger', email: uniqueEmail('rest-stranger'), role: 'CUSTOMER' });
    const strangerView = await stranger.get(`/api/restaurants/${createRes.body.data.restaurant._id}`);
    expect(strangerView.status).toBe(404); // hidden, not 403 — doesn't reveal existence

    const ownerView = await owner.get(`/api/restaurants/${createRes.body.data.restaurant._id}`);
    expect(ownerView.status).toBe(200); // owner can always see their own
  });

  it('shows an approved restaurant in public search', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rest-owner2'), role: 'RESTAURANT_OWNER' });
    const restaurant = await createApprovedRestaurant(owner);
    const res = await request(app).get('/api/restaurants').query({ search: restaurant.name });
    expect(res.body.data.restaurants.map((r) => r._id)).toContain(restaurant._id);
  });

  it("blocks one owner from updating another owner's restaurant", async () => {
    const ownerA = await registerAndLogin({ name: 'A', email: uniqueEmail('rest-a'), role: 'RESTAURANT_OWNER' });
    const ownerB = await registerAndLogin({ name: 'B', email: uniqueEmail('rest-b'), role: 'RESTAURANT_OWNER' });
    const restaurant = await createApprovedRestaurant(ownerA);
    const res = await ownerB.put(`/api/restaurants/${restaurant._id}`).send({ deliveryFee: 999 });
    expect(res.status).toBe(403);
  });

  describe('Food APIs', () => {
    async function setupMenu(owner, restaurant) {
      const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
      const category = catRes.body.data.category;
      const foodRes = await owner.post('/api/foods').send({
        restaurant: restaurant._id, category: category._id, name: 'Test Dish', price: 150, isVeg: true,
      });
      return { category, food: foodRes.body.data.food };
    }

    it('rejects a food item whose discountPrice exceeds its price', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('food-owner'), role: 'RESTAURANT_OWNER' });
      const restaurant = await createApprovedRestaurant(owner);
      const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
      const res = await owner.post('/api/foods').send({
        restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Bad Deal',
        price: 100, discountPrice: 150, isVeg: true,
      });
      expect(res.status).toBe(422);
    });

    it('rejects a category from a different restaurant when creating a food item', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('food-owner2'), role: 'RESTAURANT_OWNER' });
      const restaurantA = await createApprovedRestaurant(owner);
      const restaurantB = await createApprovedRestaurant(owner);
      const catB = await owner.post('/api/categories').send({ restaurant: restaurantB._id, name: 'Mains' });
      const res = await owner.post('/api/foods').send({
        restaurant: restaurantA._id, category: catB.body.data.category._id, name: 'Mismatch', price: 100, isVeg: true,
      });
      expect(res.status).toBe(400);
    });

    it('returns 400 for a malformed food id and 404 for a well-formed but nonexistent one', async () => {
      const malformed = await request(app).get('/api/foods/not-a-valid-id');
      expect(malformed.status).toBe(400);

      const wellFormedButMissing = await request(app).get('/api/foods/64b000000000000000000000');
      expect(wellFormedButMissing.status).toBe(404);
    });

    it('hides an unavailable item from the public menu but keeps it visible to the owner', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('food-owner3'), role: 'RESTAURANT_OWNER' });
      const restaurant = await createApprovedRestaurant(owner);
      const { food } = await setupMenu(owner, restaurant);

      await owner.put(`/api/foods/${food._id}`).send({ isAvailable: false });

      const publicMenu = await request(app).get('/api/foods').query({ restaurant: restaurant._id });
      expect(publicMenu.body.data.foods).toHaveLength(0);

      const ownerMenu = await owner.get('/api/foods').query({ restaurant: restaurant._id });
      expect(ownerMenu.body.data.foods).toHaveLength(1);
    });

    it('blocks deleting a category that still has food items', async () => {
      const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('food-owner4'), role: 'RESTAURANT_OWNER' });
      const restaurant = await createApprovedRestaurant(owner);
      const { category } = await setupMenu(owner, restaurant);
      const res = await owner.delete(`/api/categories/${category._id}`);
      expect(res.status).toBe(409);
    });
  });
});
