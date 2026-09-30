require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const FoodItem = require('../src/models/FoodItem');
const FoodCategory = require('../src/models/FoodCategory');
const Restaurant = require('../src/models/Restaurant');
const Order = require('../src/models/Order');
const pricing = require('../src/services/pricing.service');

async function ownerWithCategory() {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-o'), role: 'RESTAURANT_OWNER' });
  const restaurant = await owner.post('/api/restaurants').send({
    name: `FX Kitchen ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
  });
  const restaurantId = restaurant.body.data.restaurant._id;
  await Restaurant.findByIdAndUpdate(restaurantId, { isApproved: true });
  const category = await owner.post('/api/categories').send({ restaurant: restaurantId, name: 'Mains' });
  return { owner, restaurantId, categoryId: category.body.data.category._id };
}

const addToCart = (agent, body) => agent.post('/api/cart/items').send(body);

describe('pricing.unitPriceFor', () => {
  it('prices a food with no variants from its own discount/base price', () => {
    const food = { effectivePrice: () => 99, variants: [] };
    expect(pricing.unitPriceFor(food, undefined)).toBe(99);
  });

  it('prices a food with variants from the chosen variant, discount price first', () => {
    const withId = (id) => ({ _id: id, toString: () => id });
    const variants = [
      { _id: 'a', price: 100, discountPrice: 80, isAvailable: true },
      { _id: 'b', price: 150, isAvailable: true },
    ];
    variants.id = (id) => variants.find((v) => v._id === id) || null;
    const food = { effectivePrice: () => 80, variants };
    expect(pricing.unitPriceFor(food, 'a')).toBe(80);
    expect(pricing.unitPriceFor(food, 'b')).toBe(150);
    void withId;
  });

  it('returns null for a missing or unavailable variant', () => {
    const variants = [{ _id: 'a', price: 100, isAvailable: false }];
    variants.id = (id) => variants.find((v) => v._id === id) || null;
    const food = { effectivePrice: () => 100, variants };
    expect(pricing.unitPriceFor(food, 'a')).toBeNull();
    expect(pricing.unitPriceFor(food, 'does-not-exist')).toBeNull();
  });
});

describe('FoodItem: variants, flags, and displayPrice', () => {
  it('creates a food with variants and flags; displayPrice is the cheapest available variant', async () => {
    const { owner, restaurantId, categoryId } = await ownerWithCategory();
    const res = await owner.post('/api/foods').send({
      restaurant: restaurantId, category: categoryId, name: 'Pizza', price: 200, isVeg: true,
      variants: [
        { name: 'Small', price: 199 },
        { name: 'Medium', price: 299, discountPrice: 249 },
        { name: 'Large', price: 399, isAvailable: false },
      ],
      isRecommended: true, isBestseller: true,
    });
    expect(res.status).toBe(201);
    const { food } = res.body.data;
    expect(food.variants).toHaveLength(3);
    expect(food.isRecommended).toBe(true);
    expect(food.isBestseller).toBe(true);
    expect(food.displayPrice).toBe(199); // cheapest AVAILABLE variant (Large is unavailable and would be 399 anyway)

    const fetched = await owner.get(`/api/foods/${food._id}`);
    expect(fetched.body.data.food.displayPrice).toBe(199);
  });

  it('falls back to the cheapest variant overall when none are available', async () => {
    const { owner, restaurantId, categoryId } = await ownerWithCategory();
    const res = await owner.post('/api/foods').send({
      restaurant: restaurantId, category: categoryId, name: 'Sold Out Combo', price: 100, isVeg: true,
      variants: [{ name: 'A', price: 150, isAvailable: false }, { name: 'B', price: 120, isAvailable: false }],
    });
    expect(res.body.data.food.displayPrice).toBe(120);
  });

  it('rejects a variant discount price above its own price, too many variants, and bad flag types', async () => {
    const { owner, restaurantId, categoryId } = await ownerWithCategory();
    const base = { restaurant: restaurantId, category: categoryId, name: 'X', price: 100, isVeg: true };
    expect((await owner.post('/api/foods').send({ ...base, variants: [{ name: 'A', price: 100, discountPrice: 150 }] })).status).toBe(422);
    expect(
      (await owner.post('/api/foods').send({ ...base, variants: Array.from({ length: 21 }, (_, i) => ({ name: `V${i}`, price: 100 })) })).status
    ).toBe(422);
    expect((await owner.post('/api/foods').send({ ...base, isRecommended: 'yes' })).status).toBe(422);
  });

  it('a plain owner cannot mark isRecommended/isBestseller on a competitor\'s food, and RESTAURANT_MANAGER staff can edit any', async () => {
    const { owner, restaurantId, categoryId } = await ownerWithCategory();
    const created = await owner.post('/api/foods').send({ restaurant: restaurantId, category: categoryId, name: 'Y', price: 100, isVeg: true });
    const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('fx-s'), role: 'RESTAURANT_OWNER' });
    expect((await stranger.put(`/api/foods/${created.body.data.food._id}`).send({ isBestseller: true })).status).toBe(403);

    const { agent: manager } = await createUserWithRole('RESTAURANT_MANAGER');
    const asManager = await manager.put(`/api/foods/${created.body.data.food._id}`).send({ isBestseller: true });
    expect(asManager.status).toBe(200);
    expect(asManager.body.data.food.isBestseller).toBe(true);
  });
});

describe('cart: choosing a variant', () => {
  async function foodWithVariants(overrides = {}) {
    const { owner, restaurantId, categoryId } = await ownerWithCategory();
    const res = await owner.post('/api/foods').send({
      restaurant: restaurantId, category: categoryId, name: 'Pizza', price: 200, isVeg: true,
      variants: [{ name: 'Small', price: 199 }, { name: 'Large', price: 349, discountPrice: 299 }],
      ...overrides,
    });
    return { owner, restaurantId, food: res.body.data.food };
  }

  it('requires a variant when the food has them, and rejects one when it does not', async () => {
    const { food } = await foodWithVariants();
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-c1'), role: 'CUSTOMER' });
    const missing = await addToCart(customer, { foodId: food._id, quantity: 1 });
    expect(missing.status).toBe(400);
    expect(missing.body.message).toMatch(/choose an option/i);

    const { owner: owner2, restaurantId: r2, categoryId: c2 } = await ownerWithCategory();
    const plain = await owner2.post('/api/foods').send({ restaurant: r2, category: c2, name: 'Plain', price: 50, isVeg: true });
    const notAllowed = await addToCart(customer, { foodId: plain.body.data.food._id, quantity: 1, variantId: '507f1f77bcf86cd799439011' });
    expect(notAllowed.status).toBe(400);
    expect(notAllowed.body.message).toMatch(/does not have selectable options/i);
  });

  it('prices the line from the chosen variant, discount price included', async () => {
    const { food } = await foodWithVariants();
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-c2'), role: 'CUSTOMER' });
    const large = food.variants.find((v) => v.name === 'Large');
    const res = await addToCart(customer, { foodId: food._id, quantity: 2, variantId: large._id });
    expect(res.status).toBe(201);
    const line = res.body.data.cart.items[0];
    expect(line).toMatchObject({ price: 299, quantity: 2, variantName: 'Large' });
    expect(res.body.data.cart.subtotal).toBe(598);
  });

  it('rejects an unavailable or unknown variant id', async () => {
    const { food } = await foodWithVariants({ variants: [{ name: 'Small', price: 100 }, { name: 'Retired', price: 120, isAvailable: false }] });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-c3'), role: 'CUSTOMER' });
    const retired = food.variants.find((v) => v.name === 'Retired');
    expect((await addToCart(customer, { foodId: food._id, quantity: 1, variantId: retired._id })).status).toBe(400);
    expect((await addToCart(customer, { foodId: food._id, quantity: 1, variantId: '507f1f77bcf86cd799439011' })).status).toBe(400);
    expect((await addToCart(customer, { foodId: food._id, quantity: 1, variantId: 'not-an-id' })).status).toBe(422);
  });

  it('keeps different variants of the same food as separate cart lines, and merges identical ones', async () => {
    const { food } = await foodWithVariants();
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-c4'), role: 'CUSTOMER' });
    const [small, large] = food.variants;
    await addToCart(customer, { foodId: food._id, quantity: 1, variantId: small._id });
    await addToCart(customer, { foodId: food._id, quantity: 1, variantId: large._id });
    const again = await addToCart(customer, { foodId: food._id, quantity: 1, variantId: small._id });
    expect(again.body.data.cart.items).toHaveLength(2);
    const smallLine = again.body.data.cart.items.find((i) => i.variantName === 'Small');
    expect(smallLine.quantity).toBe(2);
  });

  it('drops a cart line if its variant is deleted from the menu (repricing, not a stale price)', async () => {
    const { owner, food } = await foodWithVariants();
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-c5'), role: 'CUSTOMER' });
    const small = food.variants[0];
    await addToCart(customer, { foodId: food._id, quantity: 1, variantId: small._id });

    await owner.put(`/api/foods/${food._id}`).send({ variants: [{ name: 'Only Large', price: 349 }] });

    const cart = await customer.get('/api/cart');
    expect(cart.body.data.cart.items).toHaveLength(0);
    expect(cart.body.data.cart.total).toBe(0);
  });
});

describe('cart: item notes', () => {
  it('stores a note, trims and caps it at 140 characters, and keeps differently-noted lines separate', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-note-o'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-note-c'), role: 'CUSTOMER' });

    const withNote = await addToCart(customer, { foodId: food._id, quantity: 1, note: '  less spicy please  ' });
    expect(withNote.body.data.cart.items[0].note).toBe('less spicy please');

    const differentNote = await addToCart(customer, { foodId: food._id, quantity: 1, note: 'no onions' });
    expect(differentNote.body.data.cart.items).toHaveLength(2);

    const same = await addToCart(customer, { foodId: food._id, quantity: 1, note: 'no onions' });
    expect(same.body.data.cart.items).toHaveLength(2);
    expect(same.body.data.cart.items.find((i) => i.note === 'no onions').quantity).toBe(2);
  });

  it('rejects a note over 140 characters', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-note-o2'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-note-c2'), role: 'CUSTOMER' });
    expect((await addToCart(customer, { foodId: food._id, quantity: 1, note: 'x'.repeat(141) })).status).toBe(422);
  });
});

describe('order: snapshots variant and note, and rejects a catalog change since checkout started', () => {
  it('records variantName and note on the placed order', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-ord-o'), role: 'RESTAURANT_OWNER' });
    const restaurant = await owner.post('/api/restaurants').send({ name: 'Ord Kitchen', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20 });
    const restaurantId = restaurant.body.data.restaurant._id;
    await Restaurant.findByIdAndUpdate(restaurantId, { isApproved: true });
    const category = await owner.post('/api/categories').send({ restaurant: restaurantId, name: 'Mains' });
    const food = await owner.post('/api/foods').send({
      restaurant: restaurantId, category: category.body.data.category._id, name: 'Biryani', price: 200, isVeg: true,
      variants: [{ name: 'Half', price: 150 }, { name: 'Full', price: 250 }],
    });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-ord-c'), role: 'CUSTOMER' });
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await addToCart(customer, { foodId: food.body.data.food._id, quantity: 1, variantId: food.body.data.food.variants[1]._id, note: 'extra raita' });

    const order = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(order.status).toBe(201);
    expect(order.body.data.order.items[0]).toMatchObject({ price: 250, variantName: 'Full', note: 'extra raita' });
  });

  it('rejects checkout if variants were added to the food after it was added to the cart', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-ord-o2'), role: 'RESTAURANT_OWNER' });
    const { food } = await setupOrderable(owner);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-ord-c2'), role: 'CUSTOMER' });
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await addToCart(customer, { foodId: food._id, quantity: 1 });

    await owner.put(`/api/foods/${food._id}`).send({ variants: [{ name: 'New Option', price: 500 }] });

    const order = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(order.status).toBe(409);
    expect(await Order.countDocuments({})).toBe(0);
  });
});

describe('restaurant: opening hours API', () => {
  it('creates a restaurant with a weekly schedule and a timezone, stored and returned as HH:MM', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-oh-o'), role: 'RESTAURANT_OWNER' });
    const res = await owner.post('/api/restaurants').send({
      name: 'Scheduled Place', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
      openingHours: [{ day: 1, open: '09:00', close: '22:00' }],
      timezone: 'Asia/Kolkata',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.restaurant.openingHours).toEqual([{ day: 1, open: 540, close: 1320 }]);
    expect(res.body.data.restaurant.timezone).toBe('Asia/Kolkata');
    expect(typeof res.body.data.restaurant.isOpenNow).toBe('boolean');
  });

  it('rejects overlapping slots and an unknown timezone, with a clear message', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-oh-o2'), role: 'RESTAURANT_OWNER' });
    const base = { name: 'X', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20 };
    const overlap = await owner.post('/api/restaurants').send({ ...base, openingHours: [{ day: 1, open: '09:00', close: '15:00' }, { day: 1, open: '14:00', close: '20:00' }] });
    expect(overlap.status).toBe(400);
    expect(overlap.body.message).toMatch(/overlap/);
    expect((await owner.post('/api/restaurants').send({ ...base, timezone: 'Mars/Colony' })).status).toBe(422);
  });

  it('lets an owner update the schedule, and clear it back to "always open"', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-oh-o3'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const set = await owner.put(`/api/restaurants/${restaurant._id}`).send({ openingHours: [{ day: 2, open: '10:00', close: '20:00' }] });
    expect(set.body.data.restaurant.openingHours).toEqual([{ day: 2, open: 600, close: 1200 }]);
    const cleared = await owner.put(`/api/restaurants/${restaurant._id}`).send({ openingHours: [] });
    expect(cleared.body.data.restaurant.openingHours).toEqual([]);
  });

  it('order placement respects the real schedule, not just the manual isOpen flag', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-oh-order'), role: 'RESTAURANT_OWNER' });
    const { restaurant, food } = await setupOrderable(owner);
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('fx-oh-cust'), role: 'CUSTOMER' });
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });

    // A schedule that excludes right now, in the restaurant's own (default) timezone —
    // Monday 00:00-00:01 is essentially never "now" for this test.
    await Restaurant.findByIdAndUpdate(restaurant._id, { openingHours: [{ day: 1, open: 0, close: 1 }], isOpen: true });
    await addToCart(customer, { foodId: food._id, quantity: 1 });
    const blocked = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/currently closed/i);

    // Clearing the schedule (always open) with isOpen still true lets the same cart through.
    await Restaurant.findByIdAndUpdate(restaurant._id, { openingHours: [] });
    const placed = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(placed.status).toBe(201);
  });

  it('nearby search filters openNow using the real schedule, and returns isOpenNow per restaurant', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('fx-oh-near'), role: 'RESTAURANT_OWNER' });
    const here = { lat: 28.5708, lng: 77.326 };
    const openAlways = await owner.post('/api/restaurants').send({
      name: 'Always Open', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Noida', deliveryTime: 20,
      location: { coordinates: [77.33, 28.573] },
    });
    const neverNow = await owner.post('/api/restaurants').send({
      name: 'Closed Now', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Noida', deliveryTime: 20,
      location: { coordinates: [77.33, 28.573] }, openingHours: [{ day: 1, open: '00:00', close: '00:01' }],
    });
    await Restaurant.updateMany({ _id: { $in: [openAlways.body.data.restaurant._id, neverNow.body.data.restaurant._id] } }, { isApproved: true });

    const res = await require('supertest')(require('./helpers').app).get('/api/restaurants/nearby').query({ ...here, openNow: 'true' });
    const names = res.body.data.restaurants.map((r) => r.name);
    expect(names).toContain('Always Open');
    expect(names).not.toContain('Closed Now');

    const all = await require('supertest')(require('./helpers').app).get('/api/restaurants/nearby').query(here);
    const byName = Object.fromEntries(all.body.data.restaurants.map((r) => [r.name, r.isOpenNow]));
    expect(byName['Always Open']).toBe(true);
    expect(typeof byName['Closed Now']).toBe('boolean');
  });
});
