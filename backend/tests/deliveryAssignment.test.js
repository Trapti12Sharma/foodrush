require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const DeliveryAssignment = require('../src/models/DeliveryAssignment');
const Order = require('../src/models/Order');

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';
const PUNE = [73.8567, 18.5204]; // [lng, lat]
const NEAR_PUNE = [73.86, 18.5215]; // ~1.5km away
const FARTHER_IN_PUNE = [73.9, 18.56]; // ~6km away — still within the 10km rider search radius, but farther
const BANGALORE = [77.5946, 12.9716]; // ~840km away — outside the rider search radius entirely

function validDPPayload(overrides = {}) {
  return {
    fullName: 'Test Rider',
    phone: '9876543210',
    address: { addressLine: '1 Rider Lane', pincode: '411001' },
    city: 'Pune',
    vehicleType: 'MOTORCYCLE',
    vehicleNumber: 'MH12AB1234',
    drivingLicenceNumber: 'DL123456789',
    drivingLicenceExpiry: '2030-01-01',
    documents: {
      identityProofUrl: DOC_URL, profilePhotoUrl: DOC_URL, drivingLicenceUrl: DOC_URL, vehicleRegistrationUrl: DOC_URL,
    },
    ...overrides,
  };
}

async function restaurantNear(owner, coordinates, opts = {}) {
  const res = await owner.post('/api/restaurants').send({
    name: `Dispatch Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    deliveryFee: opts.deliveryFee ?? 10, minimumOrder: opts.minimumOrder ?? 0,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true, location: { type: 'Point', coordinates } });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Dispatch Item', price: opts.price ?? 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

// A fully onboarded, KYC-verified, ACTIVE, ONLINE rider at a given point. Does not
// set a location if coordinates is null (used for the "no valid location" test).
async function riderAt(prefix, coordinates, admin, { online = true } = {}) {
  const agent = await registerAndLogin({ name: 'Rider', email: uniqueEmail(prefix), role: 'DELIVERY_PARTNER' });
  const created = await agent.post('/api/delivery-partners').send(validDPPayload());
  const id = created.body.data.deliveryPartner._id;
  await admin.patch(`/api/admin/delivery-partners/${id}/approve-kyc`);
  if (coordinates) await agent.patch('/api/delivery-partners/me/location').send({ latitude: coordinates[1], longitude: coordinates[0] });
  if (online) await agent.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
  return { agent, id };
}

async function placeOrder(customer, food) {
  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
  return created.body.data.order._id;
}

async function advanceToReadyForPickup(owner, orderId) {
  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    // eslint-disable-next-line no-await-in-loop
    await owner.patch(`/api/orders/${orderId}/status`).send({ status });
  }
}

// Places an order and drives it to READY_FOR_PICKUP in one call — this is the
// moment automatic dispatch fires.
async function orderReadyForDispatch(owner, customer, food) {
  const orderId = await placeOrder(customer, food);
  await advanceToReadyForPickup(owner, orderId);
  return orderId;
}

describe('Eligible rider selection', () => {
  it('finds an eligible ONLINE, ACTIVE, VERIFIED rider with a real location near the restaurant', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('elig-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('elig-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { id: riderId } = await riderAt('elig-r', NEAR_PUNE, admin);

    const orderId = await orderReadyForDispatch(owner, customer, food);
    const assignments = await DeliveryAssignment.find({ order: orderId });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].deliveryPartner.toString()).toBe(riderId);
    expect(assignments[0].status).toBe('OFFERED');
  });

  it('excludes an offline rider', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('offline-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('offline-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    await riderAt('offline-r', NEAR_PUNE, admin, { online: false });

    const orderId = await orderReadyForDispatch(owner, customer, food);
    expect(await DeliveryAssignment.countDocuments({ order: orderId })).toBe(0);
  });

  it('excludes an unverified (KYC-pending) rider', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('unverif-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('unverif-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);

    // Not KYC-approved, so cannot even go online (server-side enforced) — but set
    // a location anyway to prove it's the KYC/account gate excluding them, not the location.
    const rider = await registerAndLogin({ name: 'R', email: uniqueEmail('unverif-r'), role: 'DELIVERY_PARTNER' });
    await rider.post('/api/delivery-partners').send(validDPPayload());
    await rider.patch('/api/delivery-partners/me/location').send({ latitude: NEAR_PUNE[1], longitude: NEAR_PUNE[0] });
    const goOnline = await rider.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
    expect(goOnline.status).toBe(400);

    const orderId = await orderReadyForDispatch(owner, customer, food);
    expect(await DeliveryAssignment.countDocuments({ order: orderId })).toBe(0);
  });

  it('excludes a suspended rider', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('susp-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('susp-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { id: riderId } = await riderAt('susp-r', NEAR_PUNE, admin);
    await admin.patch(`/api/admin/delivery-partners/${riderId}/suspend`).send({ reason: 'x' });

    const orderId = await orderReadyForDispatch(owner, customer, food);
    expect(await DeliveryAssignment.countDocuments({ order: orderId })).toBe(0);
  });

  it('excludes a rider without a valid location', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('noloc-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('noloc-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    await riderAt('noloc-r', null, admin); // never sends a location

    const orderId = await orderReadyForDispatch(owner, customer, food);
    expect(await DeliveryAssignment.countDocuments({ order: orderId })).toBe(0);
  });

  it('excludes a rider outside the search radius, and picks the nearer of two eligible riders', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('near-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('near-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    await riderAt('far-r', BANGALORE, admin); // way outside the radius
    const { id: nearId } = await riderAt('near-r', NEAR_PUNE, admin);
    const { id: fartherId } = await riderAt('farther-r', FARTHER_IN_PUNE, admin);

    const orderId = await orderReadyForDispatch(owner, customer, food);
    const assignments = await DeliveryAssignment.find({ order: orderId });
    expect(assignments).toHaveLength(1);
    expect(assignments[0].deliveryPartner.toString()).toBe(nearId);
    expect(assignments[0].deliveryPartner.toString()).not.toBe(fartherId);
  });
});

describe('Assignment creation and guards', () => {
  it('creates exactly one active assignment, and a duplicate manual assign attempt is rejected (409)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('dup-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('dup-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { id: riderId } = await riderAt('dup-r1', NEAR_PUNE, admin);
    const { id: riderId2 } = await riderAt('dup-r2', NEAR_PUNE, admin);

    const orderId = await orderReadyForDispatch(owner, customer, food); // auto-dispatched to one of the two riders
    const active = await DeliveryAssignment.findOne({ order: orderId, status: 'OFFERED' });
    expect(active).toBeTruthy();
    expect([riderId, riderId2]).toContain(active.deliveryPartner.toString());

    const otherRiderId = active.deliveryPartner.toString() === riderId ? riderId2 : riderId;
    const manual = await admin.post(`/api/admin/orders/${orderId}/assign`).send({ deliveryPartnerId: otherRiderId });
    expect(manual.status).toBe(409);
  });

  it('a cancelled order cannot be assigned', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('cancel-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('cancel-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { id: riderId } = await riderAt('cancel-r', NEAR_PUNE, admin);

    const orderId = await placeOrder(customer, food);
    await customer.post(`/api/orders/${orderId}/cancel`).send({ reason: 'changed my mind' });

    const res = await admin.post(`/api/admin/orders/${orderId}/assign`).send({ deliveryPartnerId: riderId });
    expect(res.status).toBe(400);
  });

  it('a delivered (completed) order cannot be assigned', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('done-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('done-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { id: riderId } = await riderAt('done-r', NEAR_PUNE, admin);

    const orderId = await placeOrder(customer, food); // no dispatch triggers yet (still PLACED)
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      // eslint-disable-next-line no-await-in-loop
      await owner.patch(`/api/orders/${orderId}/status`).send({ status });
    }

    const res = await admin.post(`/api/admin/orders/${orderId}/assign`).send({ deliveryPartnerId: riderId });
    expect(res.status).toBe(400);
  });

  it("two riders can never both hold an active assignment for the same order (database-enforced)", async () => {
    const orderId = new (require('mongoose').Types.ObjectId)();
    const riderA = new (require('mongoose').Types.ObjectId)();
    const riderB = new (require('mongoose').Types.ObjectId)();
    await DeliveryAssignment.create({ order: orderId, deliveryPartner: riderA, status: 'OFFERED', expiresAt: new Date(Date.now() + 60000) });
    await expect(
      DeliveryAssignment.create({ order: orderId, deliveryPartner: riderB, status: 'OFFERED', expiresAt: new Date(Date.now() + 60000) })
    ).rejects.toThrow();
  });
});

describe('Rider accept / reject', () => {
  it('the rider receives the offer, and the correct rider can accept it', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('acc-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('acc-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider, id: riderId } = await riderAt('acc-r', NEAR_PUNE, admin);

    const orderId = await orderReadyForDispatch(owner, customer, food);
    const offers = await rider.get('/api/delivery-assignments/me/offers');
    expect(offers.status).toBe(200);
    expect(offers.body.data.offers).toHaveLength(1);
    const assignmentId = offers.body.data.offers[0]._id;

    const accept = await rider.patch(`/api/delivery-assignments/${assignmentId}/accept`);
    expect(accept.status).toBe(200);
    expect(accept.body.data.assignment.status).toBe('ASSIGNED');
    expect(accept.body.data.order.orderStatus).toBe('OUT_FOR_DELIVERY');
    expect(accept.body.data.order.deliveryPartner).toBe(riderId);

    const orderDoc = await Order.findById(orderId);
    expect(orderDoc.deliveryPartner.toString()).toBe(riderId);
    expect(orderDoc.orderStatus).toBe('OUT_FOR_DELIVERY');
  });

  it('a different rider cannot accept someone else\'s offer', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('wrong-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('wrong-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider } = await riderAt('wrong-r', NEAR_PUNE, admin);
    const { agent: otherRider } = await riderAt('wrong-r2', BANGALORE, admin); // out of radius, won't get offered

    await orderReadyForDispatch(owner, customer, food);
    const offers = await rider.get('/api/delivery-assignments/me/offers');
    const assignmentId = offers.body.data.offers[0]._id;

    const res = await otherRider.patch(`/api/delivery-assignments/${assignmentId}/accept`);
    expect(res.status).toBe(403);
  });

  it('an expired offer cannot be accepted', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('exp-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('exp-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider } = await riderAt('exp-r', NEAR_PUNE, admin);

    await orderReadyForDispatch(owner, customer, food);
    const offers = await rider.get('/api/delivery-assignments/me/offers');
    const assignmentId = offers.body.data.offers[0]._id;
    await DeliveryAssignment.updateOne({ _id: assignmentId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await rider.patch(`/api/delivery-assignments/${assignmentId}/accept`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
    expect((await DeliveryAssignment.findById(assignmentId)).status).toBe('EXPIRED');
  });

  it('the rider can reject an offer, recording the reason, and the order stays READY_FOR_PICKUP (not auto-cancelled/delivered)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('rej-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('rej-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider } = await riderAt('rej-r', NEAR_PUNE, admin); // the only eligible rider — nobody to reassign to

    const orderId = await orderReadyForDispatch(owner, customer, food);
    const offers = await rider.get('/api/delivery-assignments/me/offers');
    const assignmentId = offers.body.data.offers[0]._id;

    const res = await rider.patch(`/api/delivery-assignments/${assignmentId}/reject`).send({ reason: 'too busy' });
    expect(res.status).toBe(200);
    expect(res.body.data.assignment.status).toBe('REJECTED');
    expect(res.body.data.assignment.rejectionReason).toBe('too busy');
    expect(res.body.data.assignment.rejectedAt).toBeTruthy();

    const order = await Order.findById(orderId);
    expect(order.orderStatus).toBe('READY_FOR_PICKUP');
    expect(order.deliveryPartner).toBeFalsy();
  });
});

describe('Reassignment', () => {
  it('rejecting an offer immediately dispatches to the next eligible rider, and does not reuse the rejecting rider', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('reassign-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('reassign-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: riderA, id: riderAId } = await riderAt('reassign-a', NEAR_PUNE, admin);
    const { agent: riderB, id: riderBId } = await riderAt('reassign-b', FARTHER_IN_PUNE, admin);

    const orderId = await orderReadyForDispatch(owner, customer, food);
    const firstOffer = await DeliveryAssignment.findOne({ order: orderId });
    expect(firstOffer.deliveryPartner.toString()).toBe(riderAId); // nearest first

    const offersA = await riderA.get('/api/delivery-assignments/me/offers');
    const rejectRes = await riderA.patch(`/api/delivery-assignments/${offersA.body.data.offers[0]._id}/reject`).send({ reason: 'too far' });
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.assignment.status).toBe('REJECTED');

    const secondOffer = await DeliveryAssignment.findOne({ order: orderId, status: 'OFFERED' });
    expect(secondOffer).toBeTruthy();
    expect(secondOffer.deliveryPartner.toString()).toBe(riderBId);
    expect(secondOffer.deliveryPartner.toString()).not.toBe(riderAId);

    const offersB = await riderB.get('/api/delivery-assignments/me/offers');
    expect(offersB.body.data.offers).toHaveLength(1);
    const offersAAfter = await riderA.get('/api/delivery-assignments/me/offers');
    expect(offersAAfter.body.data.offers).toHaveLength(0); // A is not re-offered this order
  });

  it("an admin can manually reassign after an offer expires, skipping the expired rider", async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('manreassign-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('manreassign-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { id: riderAId } = await riderAt('manreassign-a', NEAR_PUNE, admin);
    const { id: riderBId } = await riderAt('manreassign-b', FARTHER_IN_PUNE, admin);

    const orderId = await orderReadyForDispatch(owner, customer, food);
    await DeliveryAssignment.updateOne({ order: orderId, deliveryPartner: riderAId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await admin.post(`/api/admin/orders/${orderId}/assign`).send({}); // auto — no deliveryPartnerId
    expect(res.status).toBe(201);
    expect(res.body.data.assignment.deliveryPartner).toBe(riderBId);
  });
});

describe('Admin dispatch endpoints', () => {
  it('lists eligible riders for an order, nearest first, without exposing KYC documents', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('list-elig-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('list-elig-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { id: nearId } = await riderAt('list-elig-near', NEAR_PUNE, admin);
    const { id: farId } = await riderAt('list-elig-far', FARTHER_IN_PUNE, admin);

    const orderId = await placeOrder(customer, food);
    for (const status of ['CONFIRMED', 'PREPARING']) {
      // eslint-disable-next-line no-await-in-loop
      await owner.patch(`/api/orders/${orderId}/status`).send({ status });
    }
    // Now READY_FOR_PICKUP would auto-dispatch to nearId — check the list BEFORE that.
    const res = await admin.get(`/api/admin/orders/${orderId}/eligible-riders`);
    expect(res.status).toBe(200);
    expect(res.body.data.riders.map((r) => r._id)).toEqual([nearId, farId]);
    expect(res.body.data.riders[0].documents).toBeUndefined();
    expect(res.body.data.riders[0].drivingLicenceNumber).toBeUndefined();
  });

  it('lists and filters delivery assignments, and can cancel an active one', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('admlist-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('admlist-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    await riderAt('admlist-r', NEAR_PUNE, admin);

    const orderId = await orderReadyForDispatch(owner, customer, food);
    const list = await admin.get('/api/admin/delivery-assignments').query({ order: orderId });
    expect(list.status).toBe(200);
    expect(list.body.data.assignments).toHaveLength(1);
    const assignmentId = list.body.data.assignments[0]._id;

    const cancel = await admin.patch(`/api/admin/delivery-assignments/${assignmentId}/cancel`).send({ reason: 'ops call' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.assignment.status).toBe('CANCELLED');
  });
});

describe('Security / RBAC', () => {
  it('a customer cannot create, accept, or reject assignments, and cannot use admin dispatch endpoints', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('sec-cust-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('sec-cust-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    await riderAt('sec-cust-r', NEAR_PUNE, admin);
    const orderId = await orderReadyForDispatch(owner, customer, food);
    const assignment = await DeliveryAssignment.findOne({ order: orderId });

    expect((await customer.get('/api/delivery-assignments/me/offers')).status).toBe(403);
    expect((await customer.patch(`/api/delivery-assignments/${assignment._id}/accept`)).status).toBe(403);
    expect((await customer.patch(`/api/delivery-assignments/${assignment._id}/reject`)).status).toBe(403);
    expect((await customer.get('/api/admin/delivery-assignments')).status).toBe(403);
    expect((await customer.post(`/api/admin/orders/${orderId}/assign`)).status).toBe(403);
    expect((await customer.patch(`/api/admin/delivery-assignments/${assignment._id}/cancel`)).status).toBe(403);
  });

  it('a restaurant owner cannot use admin dispatch endpoints, but can see the assigned rider on their own order', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('sec-owner-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('sec-owner-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider } = await riderAt('sec-owner-r', NEAR_PUNE, admin);
    const orderId = await orderReadyForDispatch(owner, customer, food);

    expect((await owner.get('/api/admin/delivery-assignments')).status).toBe(403);
    expect((await owner.post(`/api/admin/orders/${orderId}/assign`)).status).toBe(403);

    const offers = await rider.get('/api/delivery-assignments/me/offers');
    await rider.patch(`/api/delivery-assignments/${offers.body.data.offers[0]._id}/accept`);

    const orderDetail = await owner.get(`/api/orders/${orderId}`);
    expect(orderDetail.status).toBe(200);
    expect(orderDetail.body.data.order.deliveryPartner.fullName).toBe('Test Rider');
    expect(orderDetail.body.data.order.deliveryPartner.phone).toBeTruthy();
  });

  it('unauthenticated requests are rejected', async () => {
    const { app } = require('./helpers');
    const request = require('supertest');
    expect((await request(app).get('/api/delivery-assignments/me/offers')).status).toBe(401);
    expect((await request(app).get('/api/admin/delivery-assignments')).status).toBe(401);
  });

  it('a suspended rider cannot accept an offer already in flight', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('sec-susp-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('sec-susp-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider, id: riderId } = await riderAt('sec-susp-r', NEAR_PUNE, admin);
    await orderReadyForDispatch(owner, customer, food);
    const offers = await rider.get('/api/delivery-assignments/me/offers');

    await admin.patch(`/api/admin/delivery-partners/${riderId}/suspend`).send({ reason: 'x' });
    const res = await rider.patch(`/api/delivery-assignments/${offers.body.data.offers[0]._id}/accept`);
    expect(res.status).toBe(400);
  });

  it('an offline rider cannot accept an offer already in flight', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('sec-off-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('sec-off-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider } = await riderAt('sec-off-r', NEAR_PUNE, admin);
    await orderReadyForDispatch(owner, customer, food);
    const offers = await rider.get('/api/delivery-assignments/me/offers');

    await rider.patch('/api/delivery-partners/me/availability').send({ availability: 'OFFLINE' });
    const res = await rider.patch(`/api/delivery-assignments/${offers.body.data.offers[0]._id}/accept`);
    expect(res.status).toBe(400);
  });

  it('two concurrent accept attempts on the same offer — exactly one succeeds', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('conc-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('conc-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const { agent: rider } = await riderAt('conc-r', NEAR_PUNE, admin);
    await orderReadyForDispatch(owner, customer, food);
    const offers = await rider.get('/api/delivery-assignments/me/offers');
    const assignmentId = offers.body.data.offers[0]._id;

    const [first, second] = await Promise.all([
      rider.patch(`/api/delivery-assignments/${assignmentId}/accept`),
      rider.patch(`/api/delivery-assignments/${assignmentId}/accept`),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 400, 409]).toContain(statuses[1]);
    expect(statuses).not.toEqual([200, 200]);
  });
});

describe('Existing flows are unaffected by this milestone', () => {
  it('a normal COD order still works end to end when no rider is ever online', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('regress-cod-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('regress-cod-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const orderId = await orderReadyForDispatch(owner, customer, food);

    const order = await Order.findById(orderId);
    expect(order.orderStatus).toBe('READY_FOR_PICKUP'); // no rider available; stays here, nothing broke
    expect(order.deliveryPartner).toBeFalsy();

    // The restaurant's own manual fallback still works, exactly as before M7.
    const manualOutForDelivery = await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'OUT_FOR_DELIVERY' });
    expect(manualOutForDelivery.status).toBe(200);
    const delivered = await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'DELIVERED' });
    expect(delivered.status).toBe(200);
    expect(delivered.body.data.order.orderStatus).toBe('DELIVERED');
  });

  it('the full restaurant order-status workflow still works unchanged', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('regress-rest-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('regress-rest-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const orderId = await placeOrder(customer, food);

    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await owner.patch(`/api/orders/${orderId}/status`).send({ status });
      expect(res.status).toBe(200);
    }
  });

  it('the ONLINE Razorpay payment flow remains intact', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('regress-pay-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('regress-pay-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);

    const saved = { id: process.env.RAZORPAY_KEY_ID, secret: process.env.RAZORPAY_KEY_SECRET };
    process.env.RAZORPAY_KEY_ID = 'rzp_test_fakekey123';
    process.env.RAZORPAY_KEY_SECRET = 'test_key_secret_XYZ';
    const fetchSpy = jest.spyOn(global, 'fetch');
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'order_regress', amount: 1, currency: 'INR' }) });

    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const res = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'ONLINE' });
    expect(res.status).toBe(201);
    expect(res.body.data.razorpay.orderId).toBe('order_regress');
    expect(res.body.data.order.paymentStatus).toBe('pending');

    fetchSpy.mockRestore();
    if (saved.id === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = saved.id;
    if (saved.secret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = saved.secret;
  });
});
