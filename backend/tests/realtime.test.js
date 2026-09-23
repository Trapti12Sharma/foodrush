require('./setup');
const http = require('http');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const app = require('../src/app');
const { initSocket } = require('../src/realtime');
const { setIO } = require('../src/realtime/io');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const DeliveryPartner = require('../src/models/DeliveryPartner');
const DeliveryAssignment = require('../src/models/DeliveryAssignment');
const Order = require('../src/models/Order');

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';
const PUNE = [73.8567, 18.5204];
const NEAR_PUNE = [73.86, 18.5215];

let httpServer;
let port;

beforeAll((done) => {
  httpServer = http.createServer(app);
  initSocket(httpServer);
  httpServer.listen(0, () => {
    port = httpServer.address().port;
    done();
  });
});

afterAll((done) => {
  // Forcibly ends any socket a failed assertion left connected (its test's own
  // `.disconnect()` never ran) — otherwise a single failing test can hang this
  // whole hook, since http.Server#close() otherwise waits for every open
  // connection to end gracefully.
  httpServer.closeAllConnections?.();
  httpServer.close(() => {
    setIO(null); // don't leak this file's io instance into other test files sharing this Jest process
    done();
  });
});

async function tokenFor(email, password = 'password123') {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

function connectClient(token) {
  return ioClient(`http://localhost:${port}`, {
    auth: token !== undefined ? { token } : undefined,
    transports: ['websocket'],
    reconnection: false,
    timeout: 5000,
    forceNew: true,
  });
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (err) => reject(err));
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

// Never resolves with an event — resolves `false` if nothing arrived within the
// window, used to prove an UNAUTHORIZED client received nothing.
function assertNoEvent(socket, event, timeoutMs = 800) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

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
    documents: { identityProofUrl: DOC_URL, profilePhotoUrl: DOC_URL, drivingLicenceUrl: DOC_URL, vehicleRegistrationUrl: DOC_URL },
    ...overrides,
  };
}

async function restaurantNear(owner, coordinates) {
  const res = await owner.post('/api/restaurants').send({
    name: `Track Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true, location: { type: 'Point', coordinates } });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Track Item', price: 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

// Registers, KYC-approves, goes ONLINE and sets a location for a fresh rider —
// does NOT yet have any assignment (used for eligibility/dispatch below).
async function riderAt(prefix, coordinates, admin) {
  const email = uniqueEmail(prefix);
  const agent = await registerAndLogin({ name: 'Rider', email, role: 'DELIVERY_PARTNER' });
  const created = await agent.post('/api/delivery-partners').send(validDPPayload());
  const id = created.body.data.deliveryPartner._id;
  await admin.patch(`/api/admin/delivery-partners/${id}/approve-kyc`);
  await agent.patch('/api/delivery-partners/me/location').send({ latitude: coordinates[1], longitude: coordinates[0] });
  await agent.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
  const token = await tokenFor(email);
  return { agent, id, email, token };
}

// Full flow: order placed, driven to READY_FOR_PICKUP (auto-dispatches to the
// nearest online rider), then that rider accepts — leaving the order
// OUT_FOR_DELIVERY with a real ASSIGNED assignment, exactly the state the
// real-time layer operates on. Returns everything a test typically needs.
async function fullyAssignedDelivery(prefix, admin) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
  const customerEmail = uniqueEmail(`${prefix}-c`);
  const customer = await registerAndLogin({ name: 'C', email: customerEmail, role: 'CUSTOMER' });
  const { food } = await restaurantNear(owner, PUNE);
  const rider = await riderAt(`${prefix}-r`, NEAR_PUNE, admin);

  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
  const orderId = created.body.data.order._id;

  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    // eslint-disable-next-line no-await-in-loop
    await owner.patch(`/api/orders/${orderId}/status`).send({ status });
  }
  const offers = await rider.agent.get('/api/delivery-assignments/me/offers');
  const assignmentId = offers.body.data.offers[0]._id;
  await rider.agent.patch(`/api/delivery-assignments/${assignmentId}/accept`);

  const customerToken = await tokenFor(customerEmail);
  return { owner, customer, customerToken, rider, orderId, assignmentId };
}

describe('Socket authentication', () => {
  it('accepts a connection with a valid token', async () => {
    const email = uniqueEmail('rt-auth-ok');
    await registerAndLogin({ name: 'C', email, role: 'CUSTOMER' });
    const token = await tokenFor(email);
    const socket = connectClient(token);
    await expect(waitForConnect(socket)).resolves.toBeUndefined();
    socket.disconnect();
  });

  it('rejects a connection with an invalid token', async () => {
    const socket = connectClient('this-is-not-a-real-jwt');
    await expect(waitForConnect(socket)).rejects.toThrow();
    socket.disconnect();
  });

  it('rejects a connection with no token at all', async () => {
    const socket = connectClient(undefined);
    await expect(waitForConnect(socket)).rejects.toThrow();
    socket.disconnect();
  });
});

describe('Order room authorization', () => {
  it('lets the customer who placed the order join its tracking room', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customerToken, orderId } = await fullyAssignedDelivery('rt-ownroom', admin);
    const socket = connectClient(customerToken);
    await waitForConnect(socket);

    const res = await emitAck(socket, 'join:order', { orderId });
    expect(res.ok).toBe(true);
    socket.disconnect();
  });

  it("rejects a different customer trying to join someone else's order room", async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await fullyAssignedDelivery('rt-otherroom', admin);
    const intruderEmail = uniqueEmail('rt-intruder');
    await registerAndLogin({ name: 'I', email: intruderEmail, role: 'CUSTOMER' });
    const intruderToken = await tokenFor(intruderEmail);

    const socket = connectClient(intruderToken);
    await waitForConnect(socket);
    const res = await emitAck(socket, 'join:order', { orderId });
    expect(res.ok).toBe(false);
    socket.disconnect();
  });
});

describe('Delivery room authorization', () => {
  it('lets the assigned rider join their own delivery room', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, assignmentId } = await fullyAssignedDelivery('rt-riderjoin', admin);
    const socket = connectClient(rider.token);
    await waitForConnect(socket);

    const res = await emitAck(socket, 'join:delivery', { assignmentId });
    expect(res.ok).toBe(true);
    socket.disconnect();
  });

  it('rejects an unrelated rider trying to join a delivery room that is not theirs', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { assignmentId } = await fullyAssignedDelivery('rt-unassigned', admin);
    const outsider = await riderAt('rt-outsider', PUNE, admin); // a separate, unrelated rider

    const socket = connectClient(outsider.token);
    await waitForConnect(socket);
    const res = await emitAck(socket, 'join:delivery', { assignmentId });
    expect(res.ok).toBe(false);
    socket.disconnect();
  });
});

describe('Rider location broadcast', () => {
  it('lets the assigned rider broadcast their own location, and persists it correctly', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await fullyAssignedDelivery('rt-broadcast', admin);
    const socket = connectClient(rider.token);
    await waitForConnect(socket);

    const res = await emitAck(socket, 'rider:location', { latitude: 18.53, longitude: 73.85, accuracy: 12 });
    expect(res.ok).toBe(true);

    const stored = await DeliveryPartner.findById(rider.id);
    expect(stored.currentLocation.coordinates).toEqual([73.85, 18.53]);
    expect(stored.locationAccuracyMeters).toBe(12);
    expect(stored.lastLocationAt).toBeTruthy();
    socket.disconnect();
  });

  it('rejects invalid latitude', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await fullyAssignedDelivery('rt-badlat', admin);
    const socket = connectClient(rider.token);
    await waitForConnect(socket);

    const res = await emitAck(socket, 'rider:location', { latitude: 999, longitude: 73.85 });
    expect(res.ok).toBe(false);
    socket.disconnect();
  });

  it('rejects invalid longitude', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await fullyAssignedDelivery('rt-badlng', admin);
    const socket = connectClient(rider.token);
    await waitForConnect(socket);

    const res = await emitAck(socket, 'rider:location', { latitude: 18.53, longitude: -999 });
    expect(res.ok).toBe(false);
    socket.disconnect();
  });

  it('a rider with no active delivery cannot broadcast at all (never trusts a client-supplied order/rider id)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await fullyAssignedDelivery('rt-victim', admin);
    const bystander = await riderAt('rt-bystander', PUNE, admin); // online, verified, but no assignment at all

    const bystanderSocket = connectClient(bystander.token);
    await waitForConnect(bystanderSocket);
    const res = await emitAck(bystanderSocket, 'rider:location', { latitude: 18.53, longitude: 73.85 });
    expect(res.ok).toBe(false);

    // And critically: nothing was broadcast to the victim order's room either.
    const admin2Socket = connectClient(await tokenFor((await createUserWithRole('ADMIN')).email));
    await waitForConnect(admin2Socket);
    await emitAck(admin2Socket, 'join:order', { orderId });
    const gotEvent = await assertNoEvent(admin2Socket, 'location:update', 500);
    expect(gotEvent).toBe(false);

    bystanderSocket.disconnect();
    admin2Socket.disconnect();
  });

  it("a rider with their OWN separate active delivery broadcasts only to their own order's room, never someone else's", async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const deliveryA = await fullyAssignedDelivery('rt-orderA', admin);
    const deliveryB = await fullyAssignedDelivery('rt-orderB', admin);

    const socketA = connectClient(deliveryA.customerToken);
    await waitForConnect(socketA);
    await emitAck(socketA, 'join:order', { orderId: deliveryA.orderId });

    const riderBSocket = connectClient(deliveryB.rider.token);
    await waitForConnect(riderBSocket);
    const eventPromise = assertNoEvent(socketA, 'location:update', 800);
    await emitAck(riderBSocket, 'rider:location', { latitude: 18.6, longitude: 73.9 });

    expect(await eventPromise).toBe(false); // customer A never hears rider B's location
    socketA.disconnect();
    riderBSocket.disconnect();
  });

  it('a suspended rider is rejected even mid-delivery', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await fullyAssignedDelivery('rt-suspend', admin);
    await admin.patch(`/api/admin/delivery-partners/${rider.id}/suspend`).send({ reason: 'x' });

    const socket = connectClient(rider.token);
    await waitForConnect(socket);
    const res = await emitAck(socket, 'rider:location', { latitude: 18.53, longitude: 73.85 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/not active/i);
    socket.disconnect();
  });

  it('a rider whose KYC is not VERIFIED is rejected, independent of the account-status check', async () => {
    // accountStatus and kycStatus are deliberately coupled in the real state
    // machine (approveKyc sets both together — see deliveryPartner.service.js),
    // so a genuinely never-approved rider fails the accountStatus check first,
    // never reaching the KYC check at all. To isolate the KYC gate specifically
    // (rather than re-proving the accountStatus gate), this test constructs the
    // otherwise-unreachable ACTIVE-but-not-VERIFIED combination directly.
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('rt-unverif-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('rt-unverif-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);

    const riderEmail = uniqueEmail('rt-unverif-r');
    const riderAgent = await registerAndLogin({ name: 'R', email: riderEmail, role: 'DELIVERY_PARTNER' });
    const createdRider = await riderAgent.post('/api/delivery-partners').send(validDPPayload());
    const riderId = createdRider.body.data.deliveryPartner._id;
    await DeliveryPartner.updateOne({ _id: riderId }, { $set: { accountStatus: 'ACTIVE' } }); // kycStatus stays SUBMITTED

    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = created.body.data.order._id;
    await Order.updateOne({ _id: orderId }, { $set: { orderStatus: 'OUT_FOR_DELIVERY', deliveryPartner: riderId } });
    await DeliveryAssignment.create({ order: orderId, deliveryPartner: riderId, status: 'ASSIGNED', expiresAt: new Date(Date.now() + 60000), assignedAt: new Date() });

    const riderToken = await tokenFor(riderEmail);
    const socket = connectClient(riderToken);
    try {
      await waitForConnect(socket);
      const res = await emitAck(socket, 'rider:location', { latitude: 18.53, longitude: 73.85 });
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/kyc/i);
    } finally {
      socket.disconnect();
    }
  });
});

describe('Live delivery to authorized/unauthorized clients', () => {
  it('an authorized (joined) client receives the location:update event', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customerToken, rider, orderId } = await fullyAssignedDelivery('rt-receive', admin);

    const customerSocket = connectClient(customerToken);
    await waitForConnect(customerSocket);
    await emitAck(customerSocket, 'join:order', { orderId });

    const riderSocket = connectClient(rider.token);
    await waitForConnect(riderSocket);

    const eventPromise = waitForEvent(customerSocket, 'location:update');
    await emitAck(riderSocket, 'rider:location', { latitude: 18.55, longitude: 73.88, accuracy: 20 });
    const payload = await eventPromise;

    expect(payload.orderId).toBe(orderId);
    expect(payload.latitude).toBe(18.55);
    expect(payload.longitude).toBe(73.88);
    expect(payload.accuracy).toBe(20);
    expect(payload.updatedAt).toBeTruthy();

    customerSocket.disconnect();
    riderSocket.disconnect();
  });

  it('an unauthorized client (never joined) does not receive the location event', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId } = await fullyAssignedDelivery('rt-noreceive', admin);
    const outsiderEmail = uniqueEmail('rt-noreceive-out');
    await registerAndLogin({ name: 'O', email: outsiderEmail, role: 'CUSTOMER' });
    const outsiderSocket = connectClient(await tokenFor(outsiderEmail));
    await waitForConnect(outsiderSocket);
    // Deliberately never joins order:<orderId>.

    const riderSocket = connectClient(rider.token);
    await waitForConnect(riderSocket);
    const gotEvent = assertNoEvent(outsiderSocket, 'location:update', 800);
    await emitAck(riderSocket, 'rider:location', { latitude: 18.5, longitude: 73.86 });

    expect(await gotEvent).toBe(false);
    void orderId;
    outsiderSocket.disconnect();
    riderSocket.disconnect();
  });
});

describe('Delivery completion stops live tracking', () => {
  it('marks the assignment COMPLETED, emits tracking:ended, and the rider can no longer broadcast for that order', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { owner, customerToken, rider, orderId, assignmentId } = await fullyAssignedDelivery('rt-complete', admin);

    const customerSocket = connectClient(customerToken);
    await waitForConnect(customerSocket);
    await emitAck(customerSocket, 'join:order', { orderId });
    const endedPromise = waitForEvent(customerSocket, 'tracking:ended');

    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'DELIVERED' });
    const ended = await endedPromise;
    expect(ended.orderId).toBe(orderId);
    expect(ended.reason).toBe('delivered');

    const assignment = await DeliveryAssignment.findById(assignmentId);
    expect(assignment.status).toBe('COMPLETED');

    const riderSocket = connectClient(rider.token);
    await waitForConnect(riderSocket);
    const res = await emitAck(riderSocket, 'rider:location', { latitude: 18.5, longitude: 73.86 });
    expect(res.ok).toBe(false);

    customerSocket.disconnect();
    riderSocket.disconnect();
  });
});

describe('Disconnect / reconnect', () => {
  it('a rider can disconnect and reconnect, re-authenticate and re-join, and broadcasting still works', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, assignmentId } = await fullyAssignedDelivery('rt-reconnect', admin);

    const socket1 = connectClient(rider.token);
    await waitForConnect(socket1);
    expect((await emitAck(socket1, 'join:delivery', { assignmentId })).ok).toBe(true);
    socket1.disconnect();

    // A fresh connection, exactly as a real reconnect after a dropped network/tab
    // refresh would look from the server's point of view.
    const socket2 = connectClient(rider.token);
    await waitForConnect(socket2);
    expect((await emitAck(socket2, 'join:delivery', { assignmentId })).ok).toBe(true);
    const res = await emitAck(socket2, 'rider:location', { latitude: 18.52, longitude: 73.87 });
    expect(res.ok).toBe(true);
    socket2.disconnect();
  });
});
