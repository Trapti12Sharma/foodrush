require('./setup');
const http = require('http');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const app = require('../src/app');
const { initSocket } = require('../src/realtime');
const { setIO } = require('../src/realtime/io');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Order = require('../src/models/Order');
const DeliveryAssignment = require('../src/models/DeliveryAssignment');
const deliveryOtpService = require('../src/services/deliveryOtp.service');

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';
const PUNE = [73.8567, 18.5204];
const NEAR_PUNE = [73.86, 18.5215];

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
    name: `Otp Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true, location: { type: 'Point', coordinates } });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Otp Item', price: 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

async function riderAt(prefix, coordinates, admin) {
  const email = uniqueEmail(prefix);
  const agent = await registerAndLogin({ name: 'Rider', email, role: 'DELIVERY_PARTNER' });
  const created = await agent.post('/api/delivery-partners').send(validDPPayload());
  const id = created.body.data.deliveryPartner._id;
  await admin.patch(`/api/admin/delivery-partners/${id}/approve-kyc`);
  await agent.patch('/api/delivery-partners/me/location').send({ latitude: coordinates[1], longitude: coordinates[0] });
  await agent.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
  return { agent, id, email };
}

// Full flow up to and including rider acceptance — the order is OUT_FOR_DELIVERY
// with a real, freshly-generated OTP, exactly the state M9 operates on.
async function outForDelivery(prefix, admin) {
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

  return { owner, customer, customerEmail, rider, orderId, assignmentId };
}

async function fetchOtp(customer, orderId) {
  const res = await customer.get(`/api/orders/${orderId}/delivery-otp`);
  return res.body.data.otp;
}

describe('OTP generation and storage', () => {
  it('generates a real 6-digit OTP the moment the rider accepts, never stored as plaintext', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, orderId } = await outForDelivery('gen', admin);

    const raw = await Order.findById(orderId).select('+deliveryOtpCipher +deliveryOtpExpiresAt +deliveryOtpGeneratedAt');
    expect(raw.deliveryOtpCipher).toBeTruthy();
    expect(raw.deliveryOtpExpiresAt).toBeTruthy();
    expect(raw.deliveryOtpGeneratedAt).toBeTruthy();

    const otp = await fetchOtp(customer, orderId);
    expect(otp).toMatch(/^\d{6}$/);
    // The stored value is genuinely not the plaintext, and the encryption round-trips.
    expect(raw.deliveryOtpCipher).not.toContain(otp);
    expect(deliveryOtpService.decryptOtp(raw.deliveryOtpCipher)).toBe(otp);
  });

  it('the OTP field is select:false — a normal order fetch never includes it', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await outForDelivery('selectfalse', admin);
    const plain = await Order.findById(orderId); // no explicit .select()
    expect(plain.deliveryOtpCipher).toBeUndefined();
  });
});

describe('Customer OTP retrieval', () => {
  it('the owning customer can retrieve their own OTP while eligible', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, orderId } = await outForDelivery('own', admin);
    const res = await customer.get(`/api/orders/${orderId}/delivery-otp`);
    expect(res.status).toBe(200);
    expect(res.body.data.available).toBe(true);
    expect(res.body.data.otp).toMatch(/^\d{6}$/);
    expect(res.body.data.attemptsRemaining).toBe(5);
  });

  it('a different customer cannot retrieve someone else\'s OTP', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await outForDelivery('notmine', admin);
    const intruder = await registerAndLogin({ name: 'I', email: uniqueEmail('otp-intruder'), role: 'CUSTOMER' });
    const res = await intruder.get(`/api/orders/${orderId}/delivery-otp`);
    expect(res.status).toBe(404);
  });

  it('the restaurant owner cannot retrieve the OTP', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { owner, orderId } = await outForDelivery('ownercant', admin);
    const res = await owner.get(`/api/orders/${orderId}/delivery-otp`);
    expect(res.status).toBe(404);
  });

  it('the assigned rider cannot use the customer OTP endpoint', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId } = await outForDelivery('ridercant', admin);
    const res = await rider.agent.get(`/api/orders/${orderId}/delivery-otp`);
    expect(res.status).toBe(404);
  });

  it('is not available before OUT_FOR_DELIVERY, and not available again after DELIVERED', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('early-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('early-c'), role: 'CUSTOMER' });
    const { food } = await restaurantNear(owner, PUNE);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = created.body.data.order._id;

    const beforeReady = await customer.get(`/api/orders/${orderId}/delivery-otp`);
    expect(beforeReady.body.data.available).toBe(false);

    const { agent: admin } = await createUserWithRole('ADMIN');
    await riderAt('early-r', NEAR_PUNE, admin); // an eligible rider exists so it auto-dispatches
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
      // eslint-disable-next-line no-await-in-loop
      await owner.patch(`/api/orders/${orderId}/status`).send({ status });
    }
    const stillNotAssigned = await customer.get(`/api/orders/${orderId}/delivery-otp`);
    expect(stillNotAssigned.body.data.available).toBe(false); // READY_FOR_PICKUP, not yet accepted
  });
});

describe('Rider OTP verification', () => {
  it('the correct rider verifying the correct OTP completes the delivery', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('correct', admin);
    const otp = await fetchOtp(customer, orderId);

    const res = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });
    expect(res.status).toBe(200);
    expect(res.body.data.order.orderStatus).toBe('DELIVERED');
    expect(res.body.data.assignment.status).toBe('COMPLETED');

    const orderDoc = await Order.findById(orderId);
    expect(orderDoc.orderStatus).toBe('DELIVERED');
    const assignmentDoc = await DeliveryAssignment.findById(assignmentId);
    expect(assignmentDoc.status).toBe('COMPLETED');
    expect(assignmentDoc.completedAt).toBeTruthy();
  });

  it('rejects a wrong OTP without completing the order', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, orderId, assignmentId } = await outForDelivery('wrong', admin);
    const res = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/incorrect/i);
    expect((await Order.findById(orderId)).orderStatus).toBe('OUT_FOR_DELIVERY');
  });

  it('rejects an expired OTP', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('expired', admin);
    const otp = await fetchOtp(customer, orderId);
    await Order.updateOne({ _id: orderId }, { $set: { deliveryOtpExpiresAt: new Date(Date.now() - 1000) } });

    const res = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  it('locks out after the configured max wrong attempts, and a subsequently-correct OTP is then also rejected', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('lockout', admin);
    const otp = await fetchOtp(customer, orderId);

    for (let i = 0; i < deliveryOtpService.MAX_ATTEMPTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp: '000000' });
      expect(res.status).toBe(400);
    }
    expect((await Order.findById(orderId).select('+deliveryOtpAttempts')).deliveryOtpAttempts).toBe(deliveryOtpService.MAX_ATTEMPTS);

    const lockedOut = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp }); // the CORRECT one, too late
    expect(lockedOut.status).toBe(400);
    expect(lockedOut.body.message).toMatch(/locked/i);
    expect((await Order.findById(orderId)).orderStatus).toBe('OUT_FOR_DELIVERY');
  });

  it('cannot be reused after a successful delivery', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('reuse', admin);
    const otp = await fetchOtp(customer, orderId);
    expect((await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp })).status).toBe(200);

    const again = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });
    expect(again.status).toBe(400);
    expect((await Order.findById(orderId)).orderStatus).toBe('DELIVERED'); // unchanged, not re-processed
  });

  it('rejects a rider who is not the one assigned to this delivery', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, orderId, assignmentId } = await outForDelivery('wrongrider', admin);
    const otp = await fetchOtp(customer, orderId);
    const outsider = await riderAt('wrongrider-out', PUNE, admin);

    const res = await outsider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });
    expect(res.status).toBe(403);
  });

  it('rejects verification against a non-existent / mismatched assignment id', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider } = await outForDelivery('noassign', admin);
    const res = await rider.agent.post(`/api/delivery-assignments/${new (require('mongoose').Types.ObjectId)()}/verify-otp`).send({ otp: '123456' });
    expect(res.status).toBe(404);
  });

  it('a customer cannot call the rider verify-otp endpoint at all', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, assignmentId } = await outForDelivery('custcant', admin);
    const res = await customer.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp: '123456' });
    expect(res.status).toBe(403);
  });

  it('a restaurant owner cannot call the rider verify-otp endpoint at all', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { owner, assignmentId } = await outForDelivery('ownercant2', admin);
    const res = await owner.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp: '123456' });
    expect(res.status).toBe(403);
  });

  it('rejects malformed OTP input (missing, letters, wrong length) with 422', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { rider, assignmentId } = await outForDelivery('malformed', admin);
    expect((await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({})).status).toBe(422);
    expect((await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp: 'abcdef' })).status).toBe(422);
    expect((await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp: '123' })).status).toBe(422);
  });

  it('a cancelled order cannot be completed via OTP', async () => {
    // The existing, unchanged ORDER_STATUS_TRANSITIONS map has never allowed
    // OUT_FOR_DELIVERY -> CANCELLED (a customer's own /orders/:id/cancel call
    // correctly refuses once a rider is delivering) — so this combination cannot
    // occur through the live API today. It is still worth defending at the OTP
    // layer itself (in case that transition rule ever changes), so this test
    // constructs it directly, the same isolation technique used elsewhere in
    // this test suite for otherwise-unreachable states.
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('cancelled', admin);
    const otp = await fetchOtp(customer, orderId);
    await Order.updateOne({ _id: orderId }, { $set: { orderStatus: 'CANCELLED' } });

    const res = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });
    expect(res.status).toBe(400);
    expect((await Order.findById(orderId)).orderStatus).toBe('CANCELLED');
  });

  it('an already-DELIVERED order (completed via the existing manual admin path) cannot be completed again via OTP', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { owner, rider, orderId, assignmentId } = await outForDelivery('manualdone', admin);
    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'DELIVERED' }); // the pre-existing, unchanged fallback path

    const res = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp: '111111' });
    expect(res.status).toBe(400); // assignment already COMPLETED by the M7 hook — "not currently active"
  });

  it('two concurrent verify-otp requests with the correct code result in exactly one completion', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('concurrent', admin);
    const otp = await fetchOtp(customer, orderId);

    const [first, second] = await Promise.all([
      rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp }),
      rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp }),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses[0]).toBe(200);
    expect(statuses).not.toEqual([200, 200]);
    expect((await Order.findById(orderId)).orderStatus).toBe('DELIVERED');
    expect(await DeliveryAssignment.countDocuments({ order: orderId, status: 'COMPLETED' })).toBe(1);
  });

  it('a suspended rider cannot complete delivery even with the correct OTP', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('suspended', admin);
    const otp = await fetchOtp(customer, orderId);
    await admin.patch(`/api/admin/delivery-partners/${rider.id}/suspend`).send({ reason: 'x' });

    const res = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not active/i);
  });
});

describe('No plaintext OTP leaks', () => {
  it('never appears in the admin delivery-assignments list/detail response', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await outForDelivery('adminleak', admin);
    const list = await admin.get('/api/admin/delivery-assignments').query({ order: orderId });
    expect(JSON.stringify(list.body)).not.toMatch(/deliveryOtp/i);
  });

  it('never appears in console output during generation or verification', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { agent: admin } = await createUserWithRole('ADMIN');
      const { customer, rider, orderId, assignmentId } = await outForDelivery('nolog', admin);
      const otp = await fetchOtp(customer, orderId);
      await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });

      const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls].flat().map((v) => JSON.stringify(v)).join('\n');
      expect(allLoggedText).not.toContain(otp);
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});

describe('Review compatibility after OTP-verified delivery', () => {
  it('the customer can review the restaurant after their order is delivered via OTP', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await outForDelivery('review', admin);
    const otp = await fetchOtp(customer, orderId);
    await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });

    const order = await Order.findById(orderId);
    const res = await customer.post('/api/reviews').send({ restaurant: order.restaurant.toString(), order: orderId, rating: 5, comment: 'Great!' });
    expect(res.status).toBe(201);
  });
});

describe('M8 Socket.IO integration', () => {
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
    httpServer.closeAllConnections?.();
    httpServer.close(() => {
      setIO(null);
      done();
    });
  });

  async function tokenFor(email, password = 'password123') {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    return res.body.data.token;
  }

  function connectClient(token) {
    return ioClient(`http://localhost:${port}`, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000, forceNew: true });
  }
  function waitForConnect(socket) {
    return new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
  }
  function emitAck(socket, event, payload) {
    return new Promise((resolve) => socket.emit(event, payload, resolve));
  }
  function waitForEvent(socket, event, timeoutMs = 4000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
      socket.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  it('emits tracking:ended and stops further location broadcasting once OTP-verified delivery completes', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, customerEmail, rider, orderId, assignmentId } = await outForDelivery('sockend', admin);
    const otp = await fetchOtp(customer, orderId);
    const customerToken = await tokenFor(customerEmail);

    const customerSocket = connectClient(customerToken);
    await waitForConnect(customerSocket);
    await emitAck(customerSocket, 'join:order', { orderId });
    const endedPromise = waitForEvent(customerSocket, 'tracking:ended');

    const completion = await rider.agent.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });
    expect(completion.status).toBe(200);

    const ended = await endedPromise;
    expect(ended.orderId).toBe(orderId);
    expect(ended.reason).toBe('delivered');

    // The rider can no longer broadcast location for this now-completed delivery.
    const riderToken = await tokenFor(rider.email);
    const riderSocket = connectClient(riderToken);
    await waitForConnect(riderSocket);
    const locationRes = await emitAck(riderSocket, 'rider:location', { latitude: 18.53, longitude: 73.85 });
    expect(locationRes.ok).toBe(false);

    customerSocket.disconnect();
    riderSocket.disconnect();
  });
});
