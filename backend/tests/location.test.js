require('./setup');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail, setupOrderable } = require('./helpers');
const User = require('../src/models/User');
const Restaurant = require('../src/models/Restaurant');
const FoodCategory = require('../src/models/FoodCategory');
const FoodItem = require('../src/models/FoodItem');
const Order = require('../src/models/Order');
const geo = require('../src/utils/geo');
const { validateEnv } = require('../src/config/env');

// A customer standing in Noida Sector 18.
const HERE = { lat: 28.5708, lng: 77.326 };
const nearby = (params = {}) => request(app).get('/api/restaurants/nearby').query({ ...HERE, ...params });

let owner;
let counter = 0;
beforeEach(async () => {
  counter = 0;
  owner = await User.create({ name: 'Owner', email: uniqueEmail('loc-owner'), password: 'password123', role: 'RESTAURANT_OWNER' });
});

// lat/lng in, GeoJSON [lng, lat] stored. Pass `at: null` for a restaurant with no location.
async function makeRestaurant({ at = [28.573, 77.33], ...overrides } = {}) {
  counter += 1;
  const doc = {
    name: `Place ${counter}`, owner: owner._id, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Noida',
    deliveryTime: 20, deliveryFee: 10, isApproved: true, isActive: true,
    ...overrides,
  };
  if (at) doc.location = { coordinates: [at[1], at[0]] };
  return Restaurant.create(doc);
}

async function addFood(restaurant, { isVeg = true, price = 100, discountPrice, isAvailable = true } = {}) {
  const category = (await FoodCategory.findOne({ restaurant: restaurant._id })) || (await FoodCategory.create({ restaurant: restaurant._id, name: 'Menu' }));
  return FoodItem.create({ restaurant: restaurant._id, category: category._id, name: `Dish ${Math.random().toString(36).slice(2, 7)}`, price, discountPrice, isVeg, isAvailable });
}

const km = (lat, lng) => geo.haversineKm(HERE.lat, HERE.lng, lat, lng);
const names = (res) => res.body.data.restaurants.map((r) => r.name);

describe('geo helpers', () => {
  it('validates coordinates and treats [0,0] as "no location"', () => {
    expect(geo.isValidPointCoordinates([77.3, 28.5])).toBe(true);
    [[0, 0], [181, 10], [10, 91], [10], null, 'x', [NaN, 1], ['77', '28']].forEach((c) => expect(geo.isValidPointCoordinates(c)).toBe(false));
  });
  it('computes great-circle distances', () => {
    expect(geo.haversineKm(28.6139, 77.209, 19.076, 72.8777)).toBeGreaterThan(1130); // Delhi -> Mumbai
    expect(geo.haversineKm(28.6139, 77.209, 19.076, 72.8777)).toBeLessThan(1170);
    expect(geo.haversineKm(10, 10, 10, 10)).toBe(0);
  });
});

describe('a restaurant without a location (the old [0,0] defect)', () => {
  it('has no location at all — not [0,0] — and never appears in nearby results', async () => {
    const created = await makeRestaurant({ at: null });
    const raw = await Restaurant.collection.findOne({ _id: created._id });
    expect(raw.location).toBeUndefined();
    expect(created.deliveryRadiusKm).toBe(20);

    await makeRestaurant();
    expect(names(await nearby())).toEqual(['Place 2']);
    // ...even when the search is centred on [0,0] itself.
    const atNullIsland = await request(app).get('/api/restaurants/nearby').query({ lat: 0, lng: 0, radius: 50 });
    expect(atNullIsland.body.data.restaurants).toEqual([]);
  });

  it('created through the API without a location keeps working, and stays location-less', async () => {
    const ownerAgent = await registerAndLogin({ name: 'O', email: uniqueEmail('loc-api'), role: 'RESTAURANT_OWNER' });
    const res = await ownerAgent.post('/api/restaurants').send({ name: 'No Loc', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20 });
    expect(res.status).toBe(201);
    expect((await Restaurant.collection.findOne({ name: 'No Loc' })).location).toBeUndefined();
  });

  it('rejects [0,0], out-of-range and malformed coordinates, and bad radii, on create and update', async () => {
    const ownerAgent = await registerAndLogin({ name: 'O', email: uniqueEmail('loc-val'), role: 'RESTAURANT_OWNER' });
    const base = { name: 'Val', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20 };
    for (const location of [{ coordinates: [0, 0] }, { coordinates: [200, 10] }, { coordinates: [10, 95] }, { coordinates: [10] }, { coordinates: ['a', 'b'] }]) {
      // eslint-disable-next-line no-await-in-loop
      expect([JSON.stringify(location), (await ownerAgent.post('/api/restaurants').send({ ...base, location })).status]).toEqual([JSON.stringify(location), 422]);
    }
    expect((await ownerAgent.post('/api/restaurants').send({ ...base, deliveryRadiusKm: 0.1 })).status).toBe(422);
    expect((await ownerAgent.post('/api/restaurants').send({ ...base, deliveryRadiusKm: 80 })).status).toBe(422);

    const ok = await ownerAgent.post('/api/restaurants').send({ ...base, location: { coordinates: [77.326, 28.5708] }, deliveryRadiusKm: 7.5 });
    expect(ok.status).toBe(201);
    expect(ok.body.data.restaurant.location).toEqual({ type: 'Point', coordinates: [77.326, 28.5708] });
    expect(ok.body.data.restaurant.deliveryRadiusKm).toBe(7.5);
    const id = ok.body.data.restaurant._id;
    expect((await ownerAgent.put(`/api/restaurants/${id}`).send({ location: { coordinates: [0, 0] } })).status).toBe(422);
    expect((await ownerAgent.put(`/api/restaurants/${id}`).send({ deliveryRadiusKm: 12 })).body.data.restaurant.deliveryRadiusKm).toBe(12);
  });
});

describe('GET /api/restaurants/nearby', () => {
  it('is public and returns restaurants nearest-first with real distances and a labelled ETA', async () => {
    const close = await makeRestaurant({ name: 'Close', at: [28.573, 77.33], deliveryTime: 20 });
    await makeRestaurant({ name: 'Mid', at: [28.627, 77.3648], deliveryRadiusKm: 15, deliveryTime: 25 }); // ~8 km
    const res = await nearby({ sort: 'distance' });

    expect(res.status).toBe(200);
    expect(names(res)).toEqual(['Close', 'Mid']);
    const [first, second] = res.body.data.restaurants;
    expect(first.distanceKm).toBeCloseTo(km(28.573, 77.33), 1);
    expect(second.distanceKm).toBeCloseTo(km(28.627, 77.3648), 1);
    expect(first.estimatedDeliveryMinutes).toBe(Math.round(20 + first.distanceKm * 3));
    expect(first).toMatchObject({ deliverable: true, radiusKm: 20, _id: close._id.toString() });
    expect(res.body.data.searchedFrom).toEqual({ latitude: HERE.lat, longitude: HERE.lng, radiusKm: 10 });
  });

  it('exposes only public fields', async () => {
    await makeRestaurant();
    const [r] = (await nearby()).body.data.restaurants;
    ['owner', 'isApproved', 'isActive', 'createdAt', 'updatedAt', '__v', 'distanceMeters', 'menu'].forEach((f) => expect(r).not.toHaveProperty(f));
    ['name', 'cuisine', 'image', 'rating', 'deliveryFee', 'isOpen', 'location'].forEach((f) => expect(r).toHaveProperty(f));
  });

  it('leaves out restaurants that are unapproved, inactive, beyond the search radius, or without a location', async () => {
    await makeRestaurant({ name: 'Visible' });
    await makeRestaurant({ name: 'Pending', isApproved: false });
    await makeRestaurant({ name: 'Disabled', isActive: false });
    await makeRestaurant({ name: 'FarAway', at: [18.5196, 73.8412], deliveryRadiusKm: 50 }); // Pune
    await makeRestaurant({ name: 'NoLocation', at: null });
    expect(names(await nearby({ radius: 50 }))).toEqual(['Visible']);
  });

  it("only returns restaurants that deliver to the point — each restaurant's own radius decides", async () => {
    await makeRestaurant({ name: 'Delivers', at: [28.627, 77.3648], deliveryRadiusKm: 12 }); // ~8 km away, radius 12
    await makeRestaurant({ name: 'TooFarForItself', at: [28.627, 77.3648], deliveryRadiusKm: 5 }); // ~8 km away, radius 5
    expect(names(await nearby({ sort: 'distance' })).sort()).toEqual(['Delivers']);

    const all = await nearby({ includeOutOfRange: 'true', sort: 'distance' });
    expect(all.body.data.restaurants.map((r) => [r.name, r.deliverable]).sort()).toEqual([['Delivers', true], ['TooFarForItself', false]]);
  });

  it('applies the search radius', async () => {
    await makeRestaurant({ name: 'Near', at: [28.573, 77.33] });
    await makeRestaurant({ name: 'EightKm', at: [28.627, 77.3648], deliveryRadiusKm: 20 });
    expect(names(await nearby({ radius: 3 }))).toEqual(['Near']);
    expect(names(await nearby({ radius: 10, sort: 'distance' }))).toEqual(['Near', 'EightKm']);
  });

  it('filters by cuisine, rating, open-now, search text and estimated delivery time', async () => {
    await makeRestaurant({ name: 'Pizza Palace', cuisine: ['Italian', 'Pizza'], rating: 4.6, isOpen: true, deliveryTime: 20 });
    await makeRestaurant({ name: 'Curry House', cuisine: ['Indian'], rating: 3.9, isOpen: false, deliveryTime: 55 });
    expect(names(await nearby({ cuisine: 'pizza' }))).toEqual(['Pizza Palace']);
    expect(names(await nearby({ minRating: 4 }))).toEqual(['Pizza Palace']);
    expect(names(await nearby({ openNow: 'true' }))).toEqual(['Pizza Palace']);
    expect(names(await nearby({ search: 'curry' }))).toEqual(['Curry House']);
    expect(names(await nearby({ maxDeliveryTime: 30 }))).toEqual(['Pizza Palace']);
    expect(names(await nearby({ maxDeliveryTime: 200, sort: 'distance' })).sort()).toEqual(['Curry House', 'Pizza Palace']);
  });

  it('derives veg / non-veg / offer / price facts from each restaurant\'s available menu', async () => {
    const pureVeg = await makeRestaurant({ name: 'GreenBowl' });
    await addFood(pureVeg, { isVeg: true, price: 100 });
    await addFood(pureVeg, { isVeg: true, price: 200 });
    const mixed = await makeRestaurant({ name: 'MixedGrill' });
    await addFood(mixed, { isVeg: true, price: 300 });
    await addFood(mixed, { isVeg: false, price: 500, discountPrice: 400 });
    const empty = await makeRestaurant({ name: 'EmptyMenu' });
    await addFood(empty, { isVeg: false, isAvailable: false }); // unavailable items don't count

    const all = (await nearby({ sort: 'distance' })).body.data.restaurants;
    const by = Object.fromEntries(all.map((r) => [r.name, r]));
    expect(by.GreenBowl).toMatchObject({ isPureVeg: true, servesNonVeg: false, hasOffer: false, avgPrice: 150 });
    expect(by.MixedGrill).toMatchObject({ isPureVeg: false, servesNonVeg: true, hasOffer: true, avgPrice: 350 }); // avg of 300 and the discounted 400
    expect(by.EmptyMenu).toMatchObject({ isPureVeg: false, servesNonVeg: false, hasOffer: false, avgPrice: 0 });

    expect(names(await nearby({ veg: 'true' }))).toEqual(['GreenBowl']);
    expect(names(await nearby({ nonVeg: 'true' }))).toEqual(['MixedGrill']);
    expect(names(await nearby({ hasOffer: 'true' }))).toEqual(['MixedGrill']);
    expect(names(await nearby({ maxPrice: 200 }))).toEqual(['GreenBowl']); // empty menus are not "cheap"
    expect(names(await nearby({ maxPrice: 400, sort: 'price' }))).toEqual(['GreenBowl', 'MixedGrill']);
  });

  it('sorts by rating, distance, delivery fee, price and delivery time, with a stable order', async () => {
    const a = await makeRestaurant({ name: 'A', at: [28.573, 77.33], rating: 3.5, deliveryFee: 40, deliveryTime: 40 });
    const b = await makeRestaurant({ name: 'B', at: [28.575, 77.335], rating: 4.8, deliveryFee: 10, deliveryTime: 15 });
    const c = await makeRestaurant({ name: 'C', at: [28.58, 77.34], rating: 4.2, deliveryFee: 25, deliveryTime: 25 });
    await addFood(a, { price: 300 });
    await addFood(b, { price: 100 });
    await addFood(c, { price: 200 });

    expect(names(await nearby({ sort: 'distance' }))).toEqual(['A', 'B', 'C']);
    expect(names(await nearby({ sort: 'rating' }))).toEqual(['B', 'C', 'A']);
    expect(names(await nearby({ sort: 'deliveryFee' }))).toEqual(['B', 'C', 'A']);
    expect(names(await nearby({ sort: 'price' }))).toEqual(['B', 'C', 'A']);
    expect(names(await nearby({ sort: 'deliveryTime' }))).toEqual(['B', 'C', 'A']);
    expect(names(await nearby())).toEqual(['B', 'C', 'A']); // default: recommended (best rated first)
  });

  it('paginates with an accurate total', async () => {
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await makeRestaurant({ at: [28.573 + i * 0.001, 77.33] });
    }
    const p1 = await nearby({ sort: 'distance', limit: 2, page: 1 });
    const p3 = await nearby({ sort: 'distance', limit: 2, page: 3 });
    expect(p1.body.data.pagination).toEqual({ total: 5, page: 1, limit: 2, totalPages: 3 });
    expect(names(p1)).toHaveLength(2);
    expect(names(p3)).toHaveLength(1);
    const seen = new Set([...names(p1), ...names(await nearby({ sort: 'distance', limit: 2, page: 2 })), ...names(p3)]);
    expect(seen.size).toBe(5); // pages never overlap
  });

  it('reports an empty result for an area with no restaurants (out of delivery area)', async () => {
    await makeRestaurant({ at: [18.5196, 73.8412], deliveryRadiusKm: 50 }); // Pune
    const res = await nearby();
    expect(res.status).toBe(200);
    expect(res.body.data.restaurants).toEqual([]);
    expect(res.body.data.pagination.total).toBe(0);
  });

  it('validates every parameter', async () => {
    const bad = [{ lat: undefined }, { lng: undefined }, { lat: 95 }, { lng: -181 }, { lat: 'abc' }, { radius: 100 }, { radius: 0 }, { sort: 'cheapest' }, { veg: 'yes' }, { openNow: '1' }, { minRating: 9 }, { maxDeliveryTime: 0 }];
    for (const override of bad) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get('/api/restaurants/nearby').query({ ...HERE, ...override });
      expect([JSON.stringify(override), res.status]).toEqual([JSON.stringify(override), 422]);
    }
  });

  it('leaves the original ?near= listing unchanged', async () => {
    await makeRestaurant({ name: 'Legacy', at: [28.573, 77.33] });
    const res = await request(app).get('/api/restaurants').query({ near: `${HERE.lng},${HERE.lat}`, maxDistanceKm: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.restaurants.map((r) => r.name)).toEqual(['Legacy']);
  });
});

describe('GET /api/restaurants/cities', () => {
  it('lists cities with live restaurants, counts and an average position — no Google needed', async () => {
    await makeRestaurant({ city: 'Noida', at: [28.57, 77.32] });
    await makeRestaurant({ city: 'noida', at: [28.59, 77.36] }); // same city, different case
    await makeRestaurant({ city: 'Pune', at: [18.52, 73.84] });
    await makeRestaurant({ city: 'Hidden', isApproved: false });
    await makeRestaurant({ city: 'Nowhere', at: null });

    const res = await request(app).get('/api/restaurants/cities');
    expect(res.status).toBe(200);
    const { cities } = res.body.data;
    expect(cities.map((c) => [c.city.toLowerCase(), c.restaurantCount])).toEqual([['noida', 2], ['nowhere', 1], ['pune', 1]]);
    const noida = cities[0];
    expect(noida.latitude).toBeCloseTo(28.58, 2);
    expect(noida.longitude).toBeCloseTo(77.34, 2);
    expect(cities.find((c) => c.city === 'Nowhere').latitude).toBeNull(); // unknown, not made up
  });
});

describe('delivery radius', () => {
  it('POST /restaurants/:id/delivery-check reports in-range, out-of-range and unknown', async () => {
    const r = await makeRestaurant({ at: [28.573, 77.33], deliveryRadiusKm: 5 });
    const check = (lat, lng, id = r._id) => request(app).post(`/api/restaurants/${id}/delivery-check`).send({ latitude: lat, longitude: lng });

    const near = await check(HERE.lat, HERE.lng);
    expect(near.body.data).toMatchObject({ deliverable: true, radiusKm: 5 });
    expect(near.body.data.distanceKm).toBeCloseTo(km(28.573, 77.33), 1);
    expect(await check(28.7041, 77.1025)).toMatchObject({ body: { data: { deliverable: false, radiusKm: 5 } } }); // Delhi, ~20+ km

    // No explicit deliveryRadiusKm here, unlike `r` above — so this one reports
    // the model's own default (20km), not the 5km `r` was deliberately given.
    const unknown = await makeRestaurant({ at: null });
    expect((await check(HERE.lat, HERE.lng, unknown._id)).body.data).toEqual({ deliverable: null, distanceKm: null, radiusKm: 20 });
  });

  it('validates input, and hides unapproved restaurants from the public', async () => {
    const hidden = await makeRestaurant({ isApproved: false });
    expect((await request(app).post(`/api/restaurants/${hidden._id}/delivery-check`).send({ latitude: 28, longitude: 77 })).status).toBe(404);
    const visible = await makeRestaurant();
    for (const body of [{}, { latitude: 91, longitude: 77 }, { latitude: 28, longitude: 181 }, { latitude: 'x', longitude: 77 }]) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request(app).post(`/api/restaurants/${visible._id}/delivery-check`).send(body)).status).toBe(422);
    }
    expect((await request(app).post('/api/restaurants/not-an-id/delivery-check').send({ latitude: 28, longitude: 77 })).status).toBe(422);
  });

  describe('enforced when an order is placed', () => {
    async function orderScenario({ restaurantAt, radius = 5, addressCoords }) {
      const ownerAgent = await registerAndLogin({ name: 'O', email: uniqueEmail('dr-o'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('dr-c'), role: 'CUSTOMER' });
      const { restaurant, food } = await setupOrderable(ownerAgent);
      const update = { deliveryRadiusKm: radius };
      if (restaurantAt) update.location = { type: 'Point', coordinates: [restaurantAt[1], restaurantAt[0]] };
      await Restaurant.findByIdAndUpdate(restaurant._id, update);
      const address = await customer.post('/api/addresses').send({
        name: 'Asha K', phone: '+91 98765 43210', addressLine: '14 Test Rd', addressLine2: 'Flat 4B', landmark: 'Near the park', city: 'Noida', pincode: '201301', label: 'Work',
        ...(addressCoords ? { latitude: addressCoords[0], longitude: addressCoords[1] } : {}),
      });
      expect(address.status).toBe(201);
      await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
      return customer.post('/api/orders').send({ addressId: address.body.data.address._id, paymentMethod: 'COD' });
    }

    it('accepts an address inside the radius, snapshots the new address fields, and records the distance', async () => {
      const res = await orderScenario({ restaurantAt: [28.573, 77.33], addressCoords: [HERE.lat, HERE.lng] });
      expect(res.status).toBe(201);
      expect(res.body.data.order.deliveryDistanceKm).toBeCloseTo(km(28.573, 77.33), 1);
      expect(res.body.data.order.deliveryAddress).toMatchObject({ name: 'Asha K', phone: '+91 98765 43210', addressLine2: 'Flat 4B', landmark: 'Near the park', label: 'Work' });
    });

    it('rejects an address outside the radius, with the distance in the message, and creates no order', async () => {
      const res = await orderScenario({ restaurantAt: [28.573, 77.33], radius: 2, addressCoords: [28.627, 77.3648] }); // ~8 km, radius 2
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/doesn't deliver to that address.*km away.*within 2 km/i);
      expect(await Order.countDocuments({})).toBe(0);
    });

    it('does not block what it cannot measure: an address without coordinates, or a restaurant without a location', async () => {
      const noCoords = await orderScenario({ restaurantAt: [28.573, 77.33] });
      expect(noCoords.status).toBe(201);
      expect(noCoords.body.data.order.deliveryDistanceKm).toBeNull();

      const noLocation = await orderScenario({ restaurantAt: null, addressCoords: [HERE.lat, HERE.lng] });
      expect(noLocation.status).toBe(201);
      expect(noLocation.body.data.order.deliveryDistanceKm).toBeNull();
    });
  });
});

describe('addresses: new fields and coordinate validation', () => {
  const valid = { addressLine: '1 Home Rd', city: 'Noida', pincode: '201301' };

  it('stores name, phone, second line, landmark and confirmed coordinates', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('ad-1'), role: 'CUSTOMER' });
    const res = await customer.post('/api/addresses').send({ ...valid, label: 'Home', name: 'Asha', phone: '98765 43210', addressLine2: 'Tower B', landmark: 'Opp. metro', latitude: 28.5708, longitude: 77.326 });
    expect(res.status).toBe(201);
    expect(res.body.data.address).toMatchObject({ name: 'Asha', phone: '98765 43210', addressLine2: 'Tower B', landmark: 'Opp. metro', latitude: 28.5708, longitude: 77.326 });
    const updated = await customer.put(`/api/addresses/${res.body.data.address._id}`).send({ landmark: 'Behind the mall' });
    expect(updated.body.data.address.landmark).toBe('Behind the mall');
  });

  it('still accepts the original minimal address (no coordinates)', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('ad-2'), role: 'CUSTOMER' });
    expect((await customer.post('/api/addresses').send(valid)).status).toBe(201);
  });

  it('limits labels to Home / Work / Other on new writes', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('ad-3'), role: 'CUSTOMER' });
    for (const label of ['Home', 'Work', 'Other']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await customer.post('/api/addresses').send({ ...valid, label })).status).toBe(201);
    }
    expect((await customer.post('/api/addresses').send({ ...valid, label: 'Mum\'s place' })).status).toBe(422);
  });

  it('validates phone, lengths, and coordinates (in range, paired, and not [0,0])', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('ad-4'), role: 'CUSTOMER' });
    const bad = [
      { phone: 'abc' }, { name: 'x'.repeat(101) }, { landmark: 'x'.repeat(151) }, { addressLine2: 'x'.repeat(201) },
      { latitude: 28.5 }, { longitude: 77.3 }, { latitude: 91, longitude: 77 }, { latitude: 28, longitude: 181 }, { latitude: 0, longitude: 0 },
    ];
    for (const extra of bad) {
      // eslint-disable-next-line no-await-in-loop
      expect([JSON.stringify(extra), (await customer.post('/api/addresses').send({ ...valid, ...extra })).status]).toEqual([JSON.stringify(extra), 422]);
    }
  });

  it("keeps one customer's addresses private", async () => {
    const a = await registerAndLogin({ name: 'A', email: uniqueEmail('ad-5a'), role: 'CUSTOMER' });
    const b = await registerAndLogin({ name: 'B', email: uniqueEmail('ad-5b'), role: 'CUSTOMER' });
    const created = await a.post('/api/addresses').send({ ...valid, phone: '98765 43210' });
    expect((await b.get('/api/addresses')).body.data.addresses).toEqual([]);
    expect((await b.put(`/api/addresses/${created.body.data.address._id}`).send({ landmark: 'hijack' })).status).toBe(404);
  });
});

describe('boot validation of location settings', () => {
  const base = { NODE_ENV: 'production', MONGODB_URI: 'mongodb+srv://u:p@c.example.mongodb.net/db', JWT_SECRET: 'a'.repeat(40), CLIENT_URL: 'https://foodrush.example.com' };
  it('rejects a malformed GEO_COUNTRY and only warns (in production) when there is no Google key', () => {
    expect(validateEnv({ ...base, GEO_COUNTRY: 'india' }).errors.join(' ')).toMatch(/GEO_COUNTRY/);
    expect(validateEnv({ ...base, GEO_COUNTRY: 'in' }).errors).toEqual([]);
    expect(validateEnv(base).warnings.join(' ')).toMatch(/GOOGLE_MAPS_API_KEY is not set/);
    expect(validateEnv({ ...base, GOOGLE_MAPS_API_KEY: 'k' }).warnings.join(' ')).not.toMatch(/GOOGLE_MAPS_API_KEY/);
    expect(validateEnv({ ...base, NODE_ENV: 'development' }).warnings.join(' ')).not.toMatch(/GOOGLE_MAPS_API_KEY/);
  });
});
