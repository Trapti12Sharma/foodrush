require('./setup');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const app = require('../src/app');
const { initSocket } = require('../src/realtime');
const { setIO } = require('../src/realtime/io');
const { registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const Notification = require('../src/models/Notification');
const NotificationPreference = require('../src/models/NotificationPreference');
const notificationService = require('../src/services/notification.service');
const emailService = require('../src/services/email.service');
const Restaurant = require('../src/models/Restaurant');
const DeliveryPartner = require('../src/models/DeliveryPartner');

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';
const PUNE = [73.8567, 18.5204];

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
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data.token;
}

function connectClient(token) {
  return ioClient(`http://localhost:${port}`, {
    auth: { token },
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

function waitForEvent(socket, event, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function assertNoEvent(socket, event, timeoutMs = 800) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

function validDPPayload() {
  return {
    fullName: 'Notif Rider', phone: '9876543210', address: { addressLine: '1 Rider Lane', pincode: '411001' }, city: 'Pune',
    vehicleType: 'MOTORCYCLE', vehicleNumber: 'MH12AB1234', drivingLicenceNumber: 'DL123456789', drivingLicenceExpiry: '2030-01-01',
    documents: { identityProofUrl: DOC_URL, profilePhotoUrl: DOC_URL, drivingLicenceUrl: DOC_URL, vehicleRegistrationUrl: DOC_URL },
  };
}

// Owner + restaurant + customer + a placed COD order — the minimal fixture for
// every order/payment-adjacent test below.
async function placedOrder(prefix, opts = {}) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'C', email: uniqueEmail(`${prefix}-c`), role: 'CUSTOMER' });
  const { restaurant, food } = await setupOrderable(owner, opts);
  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: opts.paymentMethod || 'COD' });
  return { owner, customer, restaurant, food, orderId: created.body.data.order._id, order: created.body.data.order, razorpay: created.body.data.razorpay };
}

// Full dispatch+accept flow (mirrors deliveryEarning.test.js's own local
// fixture) — enough for DELIVERY_ASSIGNED/DELIVERY_ACCEPTED/DELIVERY_OTP_REQUIRED tests.
async function acceptedDelivery(prefix, admin) {
  const { owner, customer, restaurant, orderId } = await placedOrder(prefix);
  await Restaurant.findByIdAndUpdate(restaurant._id, { location: { type: 'Point', coordinates: PUNE } });

  const rider = await registerAndLogin({ name: 'Rider', email: uniqueEmail(`${prefix}-r`), role: 'DELIVERY_PARTNER' });
  const createdRider = await rider.post('/api/delivery-partners').send(validDPPayload());
  const riderId = createdRider.body.data.deliveryPartner._id;
  await admin.patch(`/api/admin/delivery-partners/${riderId}/approve-kyc`);
  await rider.patch('/api/delivery-partners/me/location').send({ latitude: PUNE[1] + 0.003, longitude: PUNE[0] + 0.003 });
  await rider.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });

  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    // eslint-disable-next-line no-await-in-loop
    await owner.patch(`/api/orders/${orderId}/status`).send({ status });
  }
  const offers = await rider.get('/api/delivery-assignments/me/offers');
  const assignmentId = offers.body.data.offers[0]._id;
  await rider.patch(`/api/delivery-assignments/${assignmentId}/accept`);

  return { owner, customer, rider, riderId, orderId, assignmentId };
}

describe('Notification service — creation, idempotency, sanitization', () => {
  it('creates a notification with the expected shape', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('create-c'), role: 'CUSTOMER' });
    const me = await customer.get('/api/auth/me');
    const notification = await notificationService.notify({
      recipient: { _id: me.body.data.user._id, role: 'CUSTOMER' },
      type: 'SYSTEM',
      data: { message: 'hello' },
      eventKey: `TEST:${me.body.data.user._id}:CREATE`,
    });
    expect(notification).toBeTruthy();
    expect(notification.recipient.toString()).toBe(me.body.data.user._id);
    expect(notification.recipientRole).toBe('CUSTOMER');
    expect(notification.channels.inApp).toBe(true);
    expect(notification.readAt).toBeNull();
  });

  it('never creates a second notification for the same eventKey (duplicate protection)', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('dup-c'), role: 'CUSTOMER' });
    const me = await customer.get('/api/auth/me');
    const recipient = { _id: me.body.data.user._id, role: 'CUSTOMER' };
    const eventKey = `TEST:${me.body.data.user._id}:DUP`;

    const first = await notificationService.notify({ recipient, type: 'SYSTEM', data: { message: 'a' }, eventKey });
    const second = await notificationService.notify({ recipient, type: 'SYSTEM', data: { message: 'a' }, eventKey });

    expect(second._id.toString()).toBe(first._id.toString());
    expect(await Notification.countDocuments({ eventKey })).toBe(1);
  });

  it('handles two truly concurrent calls with the same eventKey without creating a duplicate', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('concurrent-c'), role: 'CUSTOMER' });
    const me = await customer.get('/api/auth/me');
    const recipient = { _id: me.body.data.user._id, role: 'CUSTOMER' };
    const eventKey = `TEST:${me.body.data.user._id}:CONCURRENT`;

    const [a, b] = await Promise.all([
      notificationService.notify({ recipient, type: 'SYSTEM', data: { message: 'x' }, eventKey }),
      notificationService.notify({ recipient, type: 'SYSTEM', data: { message: 'x' }, eventKey }),
    ]);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(await Notification.countDocuments({ eventKey })).toBe(1);
  });

  it('strips anything credential/OTP-shaped from data before it is ever stored', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('sanitize-c'), role: 'CUSTOMER' });
    const me = await customer.get('/api/auth/me');
    const notification = await notificationService.notify({
      recipient: { _id: me.body.data.user._id, role: 'CUSTOMER' },
      type: 'SYSTEM',
      data: { message: 'ok', otp: '123456', password: 'hunter2', token: 'abc', razorpaySignature: 'sig', keep: 'fine' },
      eventKey: `TEST:${me.body.data.user._id}:SANITIZE`,
    });
    expect(notification.data.otp).toBeUndefined();
    expect(notification.data.password).toBeUndefined();
    expect(notification.data.token).toBeUndefined();
    expect(notification.data.razorpaySignature).toBeUndefined();
    expect(notification.data.keep).toBe('fine');
    expect(JSON.stringify(notification.data)).not.toMatch(/123456|hunter2/);
  });

  it('never throws, and returns null, for a recipient that does not exist', async () => {
    const fakeId = new mongoose.Types.ObjectId();
    const result = await notificationService.notify({ recipient: fakeId, type: 'SYSTEM', data: {} });
    expect(result).toBeNull();
  });
});

describe('Notification API — retrieval, pagination, unread count, mark read', () => {
  it('lists a customer\'s own notifications, newest first, and reflects unread count', async () => {
    const { customer } = await placedOrder('list');
    const list = await customer.get('/api/notifications');
    expect(list.status).toBe(200);
    expect(list.body.data.notifications.length).toBeGreaterThan(0);
    expect(list.body.data.notifications[0].type).toBe('ORDER_PLACED');

    const unread = await customer.get('/api/notifications/unread-count');
    expect(unread.status).toBe(200);
    expect(unread.body.data.count).toBeGreaterThan(0);
  });

  it('paginates correctly', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('page-c'), role: 'CUSTOMER' });
    const me = await customer.get('/api/auth/me');
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await notificationService.notify({
        recipient: { _id: me.body.data.user._id, role: 'CUSTOMER' },
        type: 'SYSTEM',
        data: { message: `n${i}` },
        eventKey: `TEST:${me.body.data.user._id}:PAGE:${i}`,
      });
    }
    const page1 = await customer.get('/api/notifications?limit=2&page=1');
    expect(page1.body.data.notifications).toHaveLength(2);
    expect(page1.body.data.pagination.total).toBeGreaterThanOrEqual(5);
  });

  it('filters by unread and by type', async () => {
    const { customer } = await placedOrder('filter');
    const byType = await customer.get('/api/notifications?type=ORDER_PLACED');
    expect(byType.body.data.notifications.every((n) => n.type === 'ORDER_PLACED')).toBe(true);

    const unreadOnly = await customer.get('/api/notifications?unread=true');
    expect(unreadOnly.body.data.notifications.every((n) => !n.readAt)).toBe(true);
  });

  it('marks one notification read (idempotently), and reduces the unread count', async () => {
    const { customer } = await placedOrder('markread');
    const list = await customer.get('/api/notifications');
    const id = list.body.data.notifications[0]._id;
    const before = (await customer.get('/api/notifications/unread-count')).body.data.count;

    const res = await customer.post(`/api/notifications/${id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.data.notification.readAt).toBeTruthy();

    const after = (await customer.get('/api/notifications/unread-count')).body.data.count;
    expect(after).toBe(before - 1);

    // Idempotent — marking it again just returns it, unchanged, never an error.
    const again = await customer.post(`/api/notifications/${id}/read`);
    expect(again.status).toBe(200);
  });

  it('marks every unread notification read in one call', async () => {
    const { customer } = await placedOrder('markall');
    const res = await customer.post('/api/notifications/read-all');
    expect(res.status).toBe(200);
    expect(res.body.data.modifiedCount).toBeGreaterThan(0);
    expect((await customer.get('/api/notifications/unread-count')).body.data.count).toBe(0);
  });

  it('gets a single notification by id', async () => {
    const { customer } = await placedOrder('getone');
    const list = await customer.get('/api/notifications');
    const id = list.body.data.notifications[0]._id;
    const res = await customer.get(`/api/notifications/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.notification._id).toBe(id);
  });

  it('rejects an unauthenticated caller on every endpoint', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    expect((await request(app).get('/api/notifications/unread-count')).status).toBe(401);
    expect((await request(app).post('/api/notifications/read-all')).status).toBe(401);
  });
});

describe('Notification API — cross-user authorization', () => {
  it('a customer cannot read another customer\'s notification (404, not 403)', async () => {
    const { customer: customerA } = await placedOrder('crossa');
    const customerB = await registerAndLogin({ name: 'CB', email: uniqueEmail('crossb'), role: 'CUSTOMER' });
    const listA = await customerA.get('/api/notifications');
    const idA = listA.body.data.notifications[0]._id;

    expect((await customerB.get(`/api/notifications/${idA}`)).status).toBe(404);
  });

  it('a customer cannot mark another customer\'s notification as read', async () => {
    const { customer: customerA } = await placedOrder('markxa');
    const customerB = await registerAndLogin({ name: 'CB', email: uniqueEmail('markxb'), role: 'CUSTOMER' });
    const listA = await customerA.get('/api/notifications');
    const idA = listA.body.data.notifications[0]._id;

    expect((await customerB.post(`/api/notifications/${idA}/read`)).status).toBe(404);
    // And it must genuinely be untouched — not silently "succeeded" as a no-op.
    const stillUnread = await Notification.findById(idA);
    expect(stillUnread.readAt).toBeNull();
  });

  it('a rider cannot read another rider\'s notification, and a restaurant owner cannot read a customer\'s', async () => {
    const riderA = await registerAndLogin({ name: 'RA', email: uniqueEmail('ridera'), role: 'DELIVERY_PARTNER' });
    const riderB = await registerAndLogin({ name: 'RB', email: uniqueEmail('riderb'), role: 'DELIVERY_PARTNER' });
    const meA = await riderA.get('/api/auth/me');
    const notif = await notificationService.notify({
      recipient: { _id: meA.body.data.user._id, role: 'DELIVERY_PARTNER' },
      type: 'SYSTEM',
      data: {},
      eventKey: `TEST:${meA.body.data.user._id}:RIDERISOLATION`,
    });
    expect((await riderB.get(`/api/notifications/${notif._id}`)).status).toBe(404);

    const { customer } = await placedOrder('ownerx');
    const owner = await registerAndLogin({ name: 'O2', email: uniqueEmail('ownerx-o2'), role: 'RESTAURANT_OWNER' });
    const custList = await customer.get('/api/notifications');
    expect((await owner.get(`/api/notifications/${custList.body.data.notifications[0]._id}`)).status).toBe(404);
  });
});

describe('Notification preferences API', () => {
  it('is lazily created with the documented defaults on first GET', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('pref-get'), role: 'CUSTOMER' });
    const res = await customer.get('/api/notification-preferences');
    expect(res.status).toBe(200);
    expect(res.body.data.preferences).toMatchObject({
      orderUpdates: true, paymentUpdates: true, deliveryUpdates: true, supportUpdates: true, marketing: false,
    });
  });

  it('updates only the fields sent, leaving the rest untouched', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('pref-update'), role: 'CUSTOMER' });
    await customer.get('/api/notification-preferences');
    const res = await customer.put('/api/notification-preferences').send({ paymentUpdates: false });
    expect(res.status).toBe(200);
    expect(res.body.data.preferences.paymentUpdates).toBe(false);
    expect(res.body.data.preferences.orderUpdates).toBe(true);
  });

  it('rejects a non-boolean value', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('pref-invalid'), role: 'CUSTOMER' });
    const res = await customer.put('/api/notification-preferences').send({ orderUpdates: 'yes please' });
    expect(res.status).toBe(422);
  });

  it('silently ignores an unknown key rather than persisting it', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('pref-unknown'), role: 'CUSTOMER' });
    await customer.put('/api/notification-preferences').send({ isAdmin: true, orderUpdates: false });
    const stored = await NotificationPreference.findOne({}).sort('-createdAt');
    expect(stored.toObject().isAdmin).toBeUndefined();
  });

  it('a user cannot modify another user\'s preferences — identity always comes from the session', async () => {
    const customerA = await registerAndLogin({ name: 'CA', email: uniqueEmail('prefx-a'), role: 'CUSTOMER' });
    const customerB = await registerAndLogin({ name: 'CB', email: uniqueEmail('prefx-b'), role: 'CUSTOMER' });
    await customerA.put('/api/notification-preferences').send({ marketing: true });
    await customerB.put('/api/notification-preferences').send({ marketing: false });

    const prefA = await customerA.get('/api/notification-preferences');
    const prefB = await customerB.get('/api/notification-preferences');
    expect(prefA.body.data.preferences.marketing).toBe(true);
    expect(prefB.body.data.preferences.marketing).toBe(false);
  });

  it('rejects an unauthenticated caller', async () => {
    expect((await request(app).get('/api/notification-preferences')).status).toBe(401);
    expect((await request(app).put('/api/notification-preferences').send({})).status).toBe(401);
  });
});

describe('Socket.IO notification emission', () => {
  it('pushes notification:new to the recipient\'s own socket the moment a real business event fires', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('sock-o'), role: 'RESTAURANT_OWNER' });
    const customerEmail = uniqueEmail('sock-c');
    const customer = await registerAndLogin({ name: 'C', email: customerEmail, role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });

    const token = await tokenFor(customerEmail);
    const socket = connectClient(token);
    await waitForConnect(socket);

    const eventPromise = waitForEvent(socket, 'notification:new');
    const order = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const payload = await eventPromise;

    expect(payload.type).toBe('ORDER_PLACED');
    expect(payload.data.orderId).toBe(order.body.data.order._id);
    expect(payload.title).toBeTruthy();
    // Never anything credential/token/OTP-shaped in the socket payload.
    expect(JSON.stringify(payload)).not.toMatch(/otp|password|secret|razorpay.*signature/i);

    socket.disconnect();
  });

  it('never sends a notification to an unrelated, unauthorized socket', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('sockx-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('sockx-c'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });

    const bystanderEmail = uniqueEmail('sockx-bystander');
    await registerAndLogin({ name: 'B', email: bystanderEmail, role: 'CUSTOMER' });
    const bystanderToken = await tokenFor(bystanderEmail);
    const bystanderSocket = connectClient(bystanderToken);
    await waitForConnect(bystanderSocket);

    const nothingArrived = assertNoEvent(bystanderSocket, 'notification:new', 1000);
    await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(await nothingArrived).toBe(false);

    bystanderSocket.disconnect();
  });
});

describe('Email channel — provider disabled/failure behavior', () => {
  it('is SKIPPED (never attempted) when EMAIL_PROVIDER is unset — the default test environment', async () => {
    const { customer, orderId } = await placedOrder('emailoff');
    const notification = await Notification.findOne({ recipient: (await customer.get('/api/auth/me')).body.data.user._id, 'data.orderId': new mongoose.Types.ObjectId(orderId) });
    expect(notification.emailStatus).toBe('SKIPPED');
  });

  it('records FAILED (and never breaks the triggering business operation) when the provider throws', async () => {
    const saved = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = 'smtp';
    const spy = jest.spyOn(emailService, 'sendMail').mockRejectedValueOnce(new Error('smtp connection refused'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('emailfail-o'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('emailfail-c'), role: 'CUSTOMER' });
      const { food } = await setupOrderable(owner);
      const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });

      // The order itself MUST still succeed — an email-provider outage is never
      // allowed to surface as an order-creation failure (Part 13).
      const res = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
      expect(res.status).toBe(201);

      const me = await customer.get('/api/auth/me');
      const notification = await Notification.findOne({ recipient: me.body.data.user._id, type: 'ORDER_PLACED' });
      expect(notification.emailStatus).toBe('FAILED');
      expect(notification.emailAttempts).toBeGreaterThanOrEqual(1);
      expect(notification.emailError).toBeTruthy();
    } finally {
      spy.mockRestore();
      errSpy.mockRestore();
      if (saved === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = saved;
    }
  });

  it('skips the email channel when the recipient has turned that preference off, while still creating the in-app row', async () => {
    const saved = process.env.EMAIL_PROVIDER;
    process.env.EMAIL_PROVIDER = 'log';
    try {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('prefoff-o'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('prefoff-c'), role: 'CUSTOMER' });
      await customer.put('/api/notification-preferences').send({ orderUpdates: false });
      const { food } = await setupOrderable(owner);
      const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
      await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });

      const me = await customer.get('/api/auth/me');
      const notification = await Notification.findOne({ recipient: me.body.data.user._id, type: 'ORDER_PLACED' });
      expect(notification).toBeTruthy(); // in-app row always created
      expect(notification.emailStatus).toBe('SKIPPED');
    } finally {
      if (saved === undefined) delete process.env.EMAIL_PROVIDER; else process.env.EMAIL_PROVIDER = saved;
    }
  });

  it('never gates ACCOUNT_SECURITY/SYSTEM notifications behind any preference', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('mandatory-c'), role: 'CUSTOMER' });
    await customer.put('/api/notification-preferences').send({ orderUpdates: false, paymentUpdates: false, deliveryUpdates: false, supportUpdates: false });
    const me = await customer.get('/api/auth/me');
    const notification = await notificationService.notify({
      recipient: { _id: me.body.data.user._id, role: 'CUSTOMER' },
      type: 'SYSTEM',
      data: { message: 'test' },
      eventKey: `TEST:${me.body.data.user._id}:MANDATORY`,
    });
    expect(notification).toBeTruthy(); // created regardless — SYSTEM has no gating preference field
  });
});

describe('Business-event integration', () => {
  it('order placement notifies both the customer and the restaurant owner', async () => {
    const { owner, customer, orderId } = await placedOrder('int-order');
    const meOwner = await owner.get('/api/auth/me');
    const meCustomer = await customer.get('/api/auth/me');

    const objectOrderId = new mongoose.Types.ObjectId(orderId);
    const customerNotif = await Notification.findOne({ recipient: meCustomer.body.data.user._id, type: 'ORDER_PLACED', 'data.orderId': objectOrderId });
    const ownerNotif = await Notification.findOne({ recipient: meOwner.body.data.user._id, type: 'ORDER_PLACED', 'data.orderId': objectOrderId });
    expect(customerNotif).toBeTruthy();
    expect(ownerNotif).toBeTruthy();
  });

  it('order confirm/ready/reject notify the customer', async () => {
    const { owner, customer, orderId } = await placedOrder('int-status');
    const me = await customer.get('/api/auth/me');

    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'CONFIRMED' });
    expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'ORDER_CONFIRMED' })).toBeTruthy();

    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'PREPARING' });
    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'READY_FOR_PICKUP' });
    expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'ORDER_READY' })).toBeTruthy();
  });

  it('order rejection notifies the customer', async () => {
    const { owner, customer, orderId } = await placedOrder('int-reject');
    const me = await customer.get('/api/auth/me');
    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'REJECTED' });
    expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'ORDER_REJECTED' })).toBeTruthy();
  });

  it('cancellation notifies the OTHER side, not the actor', async () => {
    const { owner, customer, orderId } = await placedOrder('int-cancel');
    const meOwner = await owner.get('/api/auth/me');
    await customer.post(`/api/orders/${orderId}/cancel`);
    expect(await Notification.findOne({ recipient: meOwner.body.data.user._id, type: 'ORDER_CANCELLED' })).toBeTruthy();
  });

  it('payment success/failure notify the customer (verify-payment path)', async () => {
    const KEY_ID = 'rzp_test_fakekey123';
    const KEY_SECRET = 'test_key_secret_XYZ';
    const savedId = process.env.RAZORPAY_KEY_ID;
    const savedSecret = process.env.RAZORPAY_KEY_SECRET;
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const sign = (orderId, paymentId, secret) => crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    try {
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('int-pay-o'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('int-pay-c'), role: 'CUSTOMER' });
      const { food } = await setupOrderable(owner);
      const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
      fetchSpy.mockResolvedValueOnce(reply(200, { id: 'order_intpay', amount: 1, currency: 'INR' }));
      const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'ONLINE' });
      const orderId = created.body.data.order._id;
      const razorpayOrderId = created.body.data.razorpay.orderId;
      const me = await customer.get('/api/auth/me');

      // Wrong signature -> PAYMENT_RETRY_REQUIRED
      await customer.post(`/api/orders/${orderId}/verify-payment`).send({
        razorpayOrderId, razorpayPaymentId: 'pay_wrong', signature: 'not-a-real-signature',
      });
      expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'PAYMENT_RETRY_REQUIRED' })).toBeTruthy();

      // Correct signature -> PAYMENT_SUCCESS
      await customer.post(`/api/orders/${orderId}/verify-payment`).send({
        razorpayOrderId, razorpayPaymentId: 'pay_intpay', signature: sign(razorpayOrderId, 'pay_intpay', KEY_SECRET),
      });
      expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'PAYMENT_SUCCESS' })).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
      if (savedId === undefined) delete process.env.RAZORPAY_KEY_ID; else process.env.RAZORPAY_KEY_ID = savedId;
      if (savedSecret === undefined) delete process.env.RAZORPAY_KEY_SECRET; else process.env.RAZORPAY_KEY_SECRET = savedSecret;
    }
  });

  it('an automatic refund notifies the customer, and a refund failure also notifies staff holding refunds:manage', async () => {
    const crypto2 = require('crypto');
    const KEY_ID = 'rzp_test_fakekey123';
    const KEY_SECRET = 'test_key_secret_XYZ';
    process.env.RAZORPAY_KEY_ID = KEY_ID;
    process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
    const sign = (orderId, paymentId, secret) => crypto2.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

    try {
      const { agent: refundAdmin } = await createUserWithRole('ADMIN');
      const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('int-refund-o'), role: 'RESTAURANT_OWNER' });
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('int-refund-c'), role: 'CUSTOMER' });
      const { food } = await setupOrderable(owner);
      const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
      fetchSpy.mockResolvedValueOnce(reply(200, { id: 'order_intrefund', amount: 1, currency: 'INR' }));
      const created = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'ONLINE' });
      const orderId = created.body.data.order._id;
      const razorpayOrderId = created.body.data.razorpay.orderId;
      await customer.post(`/api/orders/${orderId}/verify-payment`).send({
        razorpayOrderId, razorpayPaymentId: 'pay_intrefund', signature: sign(razorpayOrderId, 'pay_intrefund', KEY_SECRET),
      });
      const me = await customer.get('/api/auth/me');

      fetchSpy.mockResolvedValueOnce(reply(200, { id: 'rfnd_intrefund', amount: created.body.data.order.totalAmount * 100, status: 'processed' }));
      await customer.post(`/api/orders/${orderId}/cancel`);
      expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'REFUND_CREATED' })).toBeTruthy();
      expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'REFUND_COMPLETED' })).toBeTruthy();

      // A refund failure also reaches refunds:manage staff — ADMIN holds it.
      const { user: refundAdminUser } = { user: (await refundAdmin.get('/api/auth/me')).body.data.user };
      const owner2 = await registerAndLogin({ name: 'O2', email: uniqueEmail('int-refundfail-o'), role: 'RESTAURANT_OWNER' });
      const customer2 = await registerAndLogin({ name: 'C2', email: uniqueEmail('int-refundfail-c'), role: 'CUSTOMER' });
      const { food: food2 } = await setupOrderable(owner2);
      const addr2 = await customer2.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer2.post('/api/cart/items').send({ foodId: food2._id, quantity: 1 });
      fetchSpy.mockResolvedValueOnce(reply(200, { id: 'order_intrefundfail', amount: 1, currency: 'INR' }));
      const created2 = await customer2.post('/api/orders').send({ addressId: addr2.body.data.address._id, paymentMethod: 'ONLINE' });
      const razorpayOrderId2 = created2.body.data.razorpay.orderId;
      await customer2.post(`/api/orders/${created2.body.data.order._id}/verify-payment`).send({
        razorpayOrderId: razorpayOrderId2, razorpayPaymentId: 'pay_intrefundfail', signature: sign(razorpayOrderId2, 'pay_intrefundfail', KEY_SECRET),
      });
      const me2 = await customer2.get('/api/auth/me');
      fetchSpy.mockRejectedValueOnce(new Error('gateway down'));
      await customer2.post(`/api/orders/${created2.body.data.order._id}/cancel`);
      expect(await Notification.findOne({ recipient: me2.body.data.user._id, type: 'REFUND_FAILED' })).toBeTruthy();
      expect(await Notification.findOne({ recipient: refundAdminUser._id, type: 'REFUND_FAILED' })).toBeTruthy();
    } finally {
      fetchSpy.mockRestore();
      delete process.env.RAZORPAY_KEY_ID;
      delete process.env.RAZORPAY_KEY_SECRET;
    }
  });

  it('delivery dispatch/accept notify the rider, the restaurant owner, and the customer — with no OTP plaintext anywhere', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { owner, customer, rider, orderId } = await acceptedDelivery('int-delivery', admin);
    const meOwner = await owner.get('/api/auth/me');
    const meCustomer = await customer.get('/api/auth/me');
    const meRider = await rider.get('/api/auth/me');

    expect(await Notification.findOne({ recipient: meRider.body.data.user._id, type: 'DELIVERY_ASSIGNED', 'data.orderId': new mongoose.Types.ObjectId(orderId) })).toBeTruthy();
    expect(await Notification.findOne({ recipient: meOwner.body.data.user._id, type: 'DELIVERY_ACCEPTED' })).toBeTruthy();
    expect(await Notification.findOne({ recipient: meCustomer.body.data.user._id, type: 'ORDER_OUT_FOR_DELIVERY' })).toBeTruthy();

    const otpNotif = await Notification.findOne({ recipient: meCustomer.body.data.user._id, type: 'DELIVERY_OTP_REQUIRED' });
    expect(otpNotif).toBeTruthy();
    expect(otpNotif.data.otp).toBeUndefined();
    expect(JSON.stringify(otpNotif.toObject())).not.toMatch(/"otp"\s*:\s*"\d{6}"/);
  });

  it('OTP-verified delivery completion notifies the customer and the rider', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { customer, rider, orderId, assignmentId } = await acceptedDelivery('int-complete', admin);
    const otp = (await customer.get(`/api/orders/${orderId}/delivery-otp`)).body.data.otp;
    await rider.post(`/api/delivery-assignments/${assignmentId}/verify-otp`).send({ otp });

    const meCustomer = await customer.get('/api/auth/me');
    const meRider = await rider.get('/api/auth/me');
    expect(await Notification.findOne({ recipient: meCustomer.body.data.user._id, type: 'ORDER_DELIVERED' })).toBeTruthy();
    const riderNotif = await Notification.findOne({ recipient: meRider.body.data.user._id, type: 'DELIVERY_COMPLETED' });
    expect(riderNotif).toBeTruthy();
    expect(riderNotif.data.netAmount).toBeGreaterThan(0);
  });

  it('support ticket creation, assignment, reply and resolution each notify the right party', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { user: agentUser } = await createUserWithRole('SUPPORT_AGENT');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('int-ticket-c'), role: 'CUSTOMER' });
    const me = await customer.get('/api/auth/me');

    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const ticketId = created.body.data.ticket._id;
    expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'SUPPORT_TICKET_CREATED' })).toBeTruthy();

    await admin.patch(`/api/admin/support/tickets/${ticketId}/assign`).send({ assignedTo: agentUser._id });
    expect(await Notification.findOne({ recipient: agentUser._id, type: 'SUPPORT_TICKET_ASSIGNED' })).toBeTruthy();

    await admin.post(`/api/admin/support/tickets/${ticketId}/messages`).send({ message: 'Looking into it' });
    expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'SUPPORT_TICKET_REPLIED' })).toBeTruthy();

    await admin.patch(`/api/admin/support/tickets/${ticketId}/status`).send({ status: 'IN_PROGRESS' });
    await admin.patch(`/api/admin/support/tickets/${ticketId}/resolve`).send({});
    expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'SUPPORT_TICKET_RESOLVED' })).toBeTruthy();
  });

  it('the settlement lifecycle notifies the rider at each step', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const delivery = await acceptedDelivery('int-settle', admin);
    const otp = (await delivery.customer.get(`/api/orders/${delivery.orderId}/delivery-otp`)).body.data.otp;
    await delivery.rider.post(`/api/delivery-assignments/${delivery.assignmentId}/verify-otp`).send({ otp });
    const meRider = await delivery.rider.get('/api/auth/me');

    const gen = await admin.post('/api/admin/delivery-settlements/generate').send({
      deliveryPartnerId: delivery.riderId,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    expect(gen.status).toBe(201);
    const settlementId = gen.body.data.settlement._id;
    expect(await Notification.findOne({ recipient: meRider.body.data.user._id, type: 'SETTLEMENT_GENERATED' })).toBeTruthy();

    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`);
    expect(await Notification.findOne({ recipient: meRider.body.data.user._id, type: 'SETTLEMENT_APPROVED' })).toBeTruthy();

    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/mark-paid`).send({ payoutReference: 'UTR1' });
    expect(await Notification.findOne({ recipient: meRider.body.data.user._id, type: 'SETTLEMENT_PAID' })).toBeTruthy();
  });

  it('a settlement marked failed notifies the rider and staff holding delivery_settlements:manage', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const delivery = await acceptedDelivery('int-settlefail', admin);
    const otp = (await delivery.customer.get(`/api/orders/${delivery.orderId}/delivery-otp`)).body.data.otp;
    await delivery.rider.post(`/api/delivery-assignments/${delivery.assignmentId}/verify-otp`).send({ otp });
    const meRider = await delivery.rider.get('/api/auth/me');
    const meAdmin = await admin.get('/api/auth/me');

    const gen = await admin.post('/api/admin/delivery-settlements/generate').send({
      deliveryPartnerId: delivery.riderId,
      periodStart: new Date(Date.now() - 86400000).toISOString(),
      periodEnd: new Date(Date.now() + 86400000).toISOString(),
    });
    const settlementId = gen.body.data.settlement._id;
    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/approve`);
    await admin.patch(`/api/admin/delivery-settlements/${settlementId}/failed`).send({ reason: 'bank rejected transfer' });

    expect(await Notification.findOne({ recipient: meRider.body.data.user._id, type: 'SETTLEMENT_FAILED' })).toBeTruthy();
    expect(await Notification.findOne({ recipient: meAdmin.body.data.user._id, type: 'SETTLEMENT_FAILED' })).toBeTruthy();
  });
});
