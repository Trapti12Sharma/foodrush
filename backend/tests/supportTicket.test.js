require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable, app } = require('./helpers');
const request = require('supertest');
const SupportTicket = require('../src/models/SupportTicket');
const Restaurant = require('../src/models/Restaurant');
const DeliveryPartner = require('../src/models/DeliveryPartner');

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';
const PUNE = [73.8567, 18.5204];

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

// Owner + restaurant (located at PUNE) + customer + an order accepted by one rider
// (OUT_FOR_DELIVERY) — enough to test a delivery-partner ticket about a real,
// actually-assigned delivery, without needing the full OTP-completion flow.
async function assignedOrder(prefix, admin) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'C', email: uniqueEmail(`${prefix}-c`), role: 'CUSTOMER' });
  const { food, restaurant } = await setupOrderable(owner);
  await Restaurant.findByIdAndUpdate(restaurant._id, { location: { type: 'Point', coordinates: PUNE } });

  const riderEmail = uniqueEmail(`${prefix}-r`);
  const riderAgent = await registerAndLogin({ name: 'Rider', email: riderEmail, role: 'DELIVERY_PARTNER' });
  const created = await riderAgent.post('/api/delivery-partners').send(validDPPayload());
  const riderId = created.body.data.deliveryPartner._id;
  await admin.patch(`/api/admin/delivery-partners/${riderId}/approve-kyc`);
  await riderAgent.patch('/api/delivery-partners/me/location').send({ latitude: PUNE[1] + 0.003, longitude: PUNE[0] + 0.003 });
  await riderAgent.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });

  const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
  const createdOrder = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
  const orderId = createdOrder.body.data.order._id;
  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP']) {
    // eslint-disable-next-line no-await-in-loop
    await owner.patch(`/api/orders/${orderId}/status`).send({ status });
  }
  const offers = await riderAgent.get('/api/delivery-assignments/me/offers');
  const assignmentId = offers.body.data.offers[0]._id;
  await riderAgent.patch(`/api/delivery-assignments/${assignmentId}/accept`);

  return { owner, customer, riderAgent, riderId, orderId, assignmentId, restaurant };
}

describe('Support tickets — creation', () => {
  it('a customer can create a ticket', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('cr-cust'), role: 'CUSTOMER' });
    const res = await customer.post('/api/support/tickets').send({ category: 'ACCOUNT', subject: 'Cannot update phone number', description: 'The field is greyed out.' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.ticketNumber).toMatch(/^FR-TKT-\d{6}$/);
    expect(res.body.data.ticket.createdByRole).toBe('CUSTOMER');
    expect(res.body.data.ticket.status).toBe('OPEN');
  });

  it('a delivery partner can create a ticket', async () => {
    const rider = await registerAndLogin({ name: 'R', email: uniqueEmail('cr-rider'), role: 'DELIVERY_PARTNER' });
    const res = await rider.post('/api/support/tickets').send({ category: 'TECHNICAL', subject: 'App crashes on accept', description: 'Happens every time.' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.createdByRole).toBe('DELIVERY_PARTNER');
  });

  it('a restaurant owner can create a ticket about their own restaurant', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('cr-owner'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner);
    const res = await owner.post('/api/support/tickets').send({
      category: 'RESTAURANT', subject: 'Menu photos not updating', description: 'Uploaded new photos but old ones still show.', restaurantId: restaurant._id,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.restaurant).toBe(restaurant._id);
  });

  it('a restaurant owner cannot create a ticket about a restaurant they do not own', async () => {
    const owner1 = await registerAndLogin({ name: 'O1', email: uniqueEmail('cr-o1'), role: 'RESTAURANT_OWNER' });
    const owner2 = await registerAndLogin({ name: 'O2', email: uniqueEmail('cr-o2'), role: 'RESTAURANT_OWNER' });
    const { restaurant } = await setupOrderable(owner1);
    const res = await owner2.post('/api/support/tickets').send({
      category: 'RESTAURANT', subject: 'x', description: 'y', restaurantId: restaurant._id,
    });
    expect(res.status).toBe(403);
  });

  it('an admin can also create a ticket', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.post('/api/support/tickets').send({ category: 'OTHER', subject: 'Internal note', description: 'Testing admin-created ticket.' });
    expect(res.status).toBe(201);
  });

  it('an unauthenticated caller is rejected', async () => {
    const res = await request(app).post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    expect(res.status).toBe(401);
  });

  it('rejects a category/subject/description that fails validation', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('cr-invalid'), role: 'CUSTOMER' });
    const res = await customer.post('/api/support/tickets').send({ category: 'NOT_A_CATEGORY', subject: '', description: '' });
    expect(res.status).toBe(422);
  });

  it('a customer can create a ticket about their own order, and the order is validated', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('cro-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('cro-c'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const order = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const orderId = order.body.data.order._id;
    const me = await customer.get('/api/auth/me');

    const res = await customer.post('/api/support/tickets').send({ category: 'ORDER', subject: 'Where is my food', description: 'Order is late.', orderId });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.order).toBe(orderId);
    expect(res.body.data.ticket.customer).toBe(me.body.data.user._id);
  });

  it('a customer cannot create a ticket about someone else\'s order', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('crx-o'), role: 'RESTAURANT_OWNER' });
    const customerA = await registerAndLogin({ name: 'CA', email: uniqueEmail('crx-ca'), role: 'CUSTOMER' });
    const customerB = await registerAndLogin({ name: 'CB', email: uniqueEmail('crx-cb'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner);
    const addr = await customerA.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customerA.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const order = await customerA.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });

    const res = await customerB.post('/api/support/tickets').send({ category: 'ORDER', subject: 'x', description: 'y', orderId: order.body.data.order._id });
    expect(res.status).toBe(403);
  });

  it('a delivery partner can create a ticket about a delivery they were actually assigned', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { riderAgent, orderId } = await assignedOrder('darider', admin);
    const res = await riderAgent.post('/api/support/tickets').send({ category: 'DELIVERY', subject: 'Restaurant not ready', description: 'Waiting 20 minutes.', orderId });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.order).toBe(orderId);
    expect(res.body.data.ticket.deliveryPartner).toBeTruthy();
  });

  it('a delivery partner cannot create a ticket about a delivery they were never assigned', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { orderId } = await assignedOrder('danot', admin);
    const otherRider = await registerAndLogin({ name: 'R2', email: uniqueEmail('danot-r2'), role: 'DELIVERY_PARTNER' });
    const res = await otherRider.post('/api/support/tickets').send({ category: 'DELIVERY', subject: 'x', description: 'y', orderId });
    expect(res.status).toBe(403);
  });
});

describe('Support tickets — access control', () => {
  it('a customer cannot access another customer\'s ticket (404, not 403)', async () => {
    const customerA = await registerAndLogin({ name: 'CA', email: uniqueEmail('ac-ca'), role: 'CUSTOMER' });
    const customerB = await registerAndLogin({ name: 'CB', email: uniqueEmail('ac-cb'), role: 'CUSTOMER' });
    const created = await customerA.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const res = await customerB.get(`/api/support/tickets/${created.body.data.ticket._id}`);
    expect(res.status).toBe(404);
  });

  it('a delivery partner cannot access another delivery partner\'s ticket', async () => {
    const riderA = await registerAndLogin({ name: 'RA', email: uniqueEmail('ar-ra'), role: 'DELIVERY_PARTNER' });
    const riderB = await registerAndLogin({ name: 'RB', email: uniqueEmail('ar-rb'), role: 'DELIVERY_PARTNER' });
    const created = await riderA.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const res = await riderB.get(`/api/support/tickets/${created.body.data.ticket._id}`);
    expect(res.status).toBe(404);
  });

  it('a restaurant owner cannot access another restaurant owner\'s ticket', async () => {
    const owner1 = await registerAndLogin({ name: 'O1', email: uniqueEmail('ao-o1'), role: 'RESTAURANT_OWNER' });
    const owner2 = await registerAndLogin({ name: 'O2', email: uniqueEmail('ao-o2'), role: 'RESTAURANT_OWNER' });
    const created = await owner1.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const res = await owner2.get(`/api/support/tickets/${created.body.data.ticket._id}`);
    expect(res.status).toBe(404);
  });

  it('the customer who created a ticket can fetch it, with the order populated', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('own-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('own-c'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner);
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const order = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    const created = await customer.post('/api/support/tickets').send({ category: 'ORDER', subject: 'x', description: 'y', orderId: order.body.data.order._id });

    const res = await customer.get(`/api/support/tickets/${created.body.data.ticket._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.order.orderNumber).toBeTruthy();
  });

  it('the assigned rider can fetch their own delivery-linked ticket', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { riderAgent, orderId } = await assignedOrder('fetchrider', admin);
    const created = await riderAgent.post('/api/support/tickets').send({ category: 'DELIVERY', subject: 'x', description: 'y', orderId });
    const res = await riderAgent.get(`/api/support/tickets/${created.body.data.ticket._id}`);
    expect(res.status).toBe(200);
  });
});

describe('Support tickets — replies and closing', () => {
  it('the ticket creator can reply to their own open ticket', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('reply-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const res = await customer.post(`/api/support/tickets/${created.body.data.ticket._id}/messages`).send({ message: 'Any update?' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.messages).toHaveLength(1);
    expect(res.body.data.ticket.messages[0].senderRole).toBe('CUSTOMER');
  });

  it('a customer can close their own ticket', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('close-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const res = await customer.patch(`/api/support/tickets/${created.body.data.ticket._id}/close`);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.status).toBe('CLOSED');
  });

  it('a closed ticket cannot receive a normal reply', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('closed-reply-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    await customer.patch(`/api/support/tickets/${created.body.data.ticket._id}/close`);
    const res = await customer.post(`/api/support/tickets/${created.body.data.ticket._id}/messages`).send({ message: 'Still there?' });
    expect(res.status).toBe(400);
  });

  it('cannot close an already-closed ticket', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('doubleclose-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    await customer.patch(`/api/support/tickets/${created.body.data.ticket._id}/close`);
    const res = await customer.patch(`/api/support/tickets/${created.body.data.ticket._id}/close`);
    expect(res.status).toBe(400);
  });
});

describe('Support tickets — admin management', () => {
  it('a customer/restaurant owner/delivery partner cannot access the admin support surface', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('noadmin-c'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('noadmin-o'), role: 'RESTAURANT_OWNER' });
    const rider = await registerAndLogin({ name: 'R', email: uniqueEmail('noadmin-r'), role: 'DELIVERY_PARTNER' });
    expect((await customer.get('/api/admin/support/tickets')).status).toBe(403);
    expect((await owner.get('/api/admin/support/tickets')).status).toBe(403);
    expect((await rider.get('/api/admin/support/tickets')).status).toBe(403);
  });

  it('an admin can fetch any ticket via the admin surface', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('adget-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });

    const res = await admin.get(`/api/admin/support/tickets/${created.body.data.ticket._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.createdBy.name).toBe('C');
  });

  it('an admin can move a ticket through a valid status transition', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('adstatus-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const id = created.body.data.ticket._id;

    const res = await admin.patch(`/api/admin/support/tickets/${id}/status`).send({ status: 'IN_PROGRESS' });
    expect(res.status).toBe(200);
    expect(res.body.data.ticket.status).toBe('IN_PROGRESS');
  });

  it('rejects an invalid status transition (OPEN straight to RESOLVED)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('adbad-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });

    const res = await admin.patch(`/api/admin/support/tickets/${created.body.data.ticket._id}/status`).send({ status: 'RESOLVED' });
    expect(res.status).toBe(400);
  });

  it('walks a ticket OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED, then rejects any further transition', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('adlife-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const id = created.body.data.ticket._id;

    await admin.patch(`/api/admin/support/tickets/${id}/status`).send({ status: 'IN_PROGRESS' }).expect(200);
    const resolved = await admin.patch(`/api/admin/support/tickets/${id}/resolve`).send({ resolution: 'Fixed it' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.ticket.status).toBe('RESOLVED');
    expect(resolved.body.data.ticket.resolution).toBe('Fixed it');

    const closed = await admin.patch(`/api/admin/support/tickets/${id}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.ticket.status).toBe('CLOSED');

    const rejected = await admin.patch(`/api/admin/support/tickets/${id}/status`).send({ status: 'OPEN' });
    expect(rejected.status).toBe(400);
  });

  it('supports an explicit, controlled reopen from RESOLVED back to IN_PROGRESS', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('reopen-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const id = created.body.data.ticket._id;
    await admin.patch(`/api/admin/support/tickets/${id}/status`).send({ status: 'IN_PROGRESS' });
    await admin.patch(`/api/admin/support/tickets/${id}/resolve`).send({});

    const reopened = await admin.patch(`/api/admin/support/tickets/${id}/status`).send({ status: 'IN_PROGRESS' });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data.ticket.status).toBe('IN_PROGRESS');
    expect(reopened.body.data.ticket.resolvedAt).toBeNull();

    // Now the customer can reply again — a resolved ticket that was reopened accepts messages.
    const reply = await customer.post(`/api/support/tickets/${id}/messages`).send({ message: 'Still broken' });
    expect(reply.status).toBe(201);
  });

  it('an admin can assign a ticket to a support-capable staff member, and unassign it', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { user: agentUser } = await createUserWithRole('SUPPORT_AGENT');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('assign-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const id = created.body.data.ticket._id;

    const assigned = await admin.patch(`/api/admin/support/tickets/${id}/assign`).send({ assignedTo: agentUser._id });
    expect(assigned.status).toBe(200);
    expect(assigned.body.data.ticket.assignedTo).toBe(agentUser._id.toString());

    const unassigned = await admin.patch(`/api/admin/support/tickets/${id}/assign`).send({});
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.ticket.assignedTo).toBeNull();
  });

  it('rejects assigning a ticket to a normal customer/rider/owner (not a support-capable staff member)', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('badassign-c'), role: 'CUSTOMER' });
    const { user: notStaff } = await createUserWithRole('CUSTOMER', 'notstaff');
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });

    const res = await admin.patch(`/api/admin/support/tickets/${created.body.data.ticket._id}/assign`).send({ assignedTo: notStaff._id });
    expect(res.status).toBe(400);
  });

  it('a normal user cannot assign a ticket to themselves (route requires support_tickets:manage)', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('selfassign-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const me = await customer.get('/api/auth/me');

    const res = await customer.patch(`/api/admin/support/tickets/${created.body.data.ticket._id}/assign`).send({ assignedTo: me.body.data.user._id });
    expect(res.status).toBe(403);
  });

  it('an unauthenticated caller cannot assign a ticket', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('unauthassign-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const res = await request(app).patch(`/api/admin/support/tickets/${created.body.data.ticket._id}/assign`).send({});
    expect(res.status).toBe(401);
  });

  it('staff can reply to a ticket, and it is distinguishable from the creator\'s own messages', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('staffreply-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });

    const res = await admin.post(`/api/admin/support/tickets/${created.body.data.ticket._id}/messages`).send({ message: 'We are looking into it' });
    expect(res.status).toBe(201);
    expect(res.body.data.ticket.messages[0].senderRole).toBe('ADMIN');
  });

  it('staff cannot reply to a closed ticket', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('staffclosed-c'), role: 'CUSTOMER' });
    const created = await customer.post('/api/support/tickets').send({ category: 'OTHER', subject: 'x', description: 'y' });
    const id = created.body.data.ticket._id;
    await customer.patch(`/api/support/tickets/${id}/close`);

    const res = await admin.post(`/api/admin/support/tickets/${id}/messages`).send({ message: 'Hello?' });
    expect(res.status).toBe(400);
  });

  it('pagination and filters work on the admin listing', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('page-c'), role: 'CUSTOMER' });
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await customer.post('/api/support/tickets').send({ category: 'PAYMENT', subject: `Payment issue ${i}`, description: 'x' });
    }

    const page1 = await admin.get('/api/admin/support/tickets?category=PAYMENT&limit=2&page=1');
    expect(page1.status).toBe(200);
    expect(page1.body.data.tickets).toHaveLength(2);
    expect(page1.body.data.pagination.total).toBe(3);

    const filtered = await admin.get('/api/admin/support/tickets?category=ACCOUNT');
    expect(filtered.body.data.tickets.every((t) => t.category === 'ACCOUNT')).toBe(true);
  });
});

describe('Support tickets — concurrency', () => {
  it('assigns a unique ticket number to every ticket created concurrently', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('concurrent-c'), role: 'CUSTOMER' });
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) => customer.post('/api/support/tickets').send({ category: 'OTHER', subject: `Concurrent ${i}`, description: 'x' }))
    );
    results.forEach((r) => expect(r.status).toBe(201));
    const numbers = results.map((r) => r.body.data.ticket.ticketNumber);
    expect(new Set(numbers).size).toBe(5);

    const count = await SupportTicket.countDocuments({ ticketNumber: { $in: numbers } });
    expect(count).toBe(5);
  });
});

describe('Support tickets — regression: existing delivery-partner records untouched', () => {
  it('creating a support ticket does not alter the delivery partner profile it references', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const { riderId, orderId, riderAgent } = await assignedOrder('regression', admin);
    const before = await DeliveryPartner.findById(riderId).lean();
    await riderAgent.post('/api/support/tickets').send({ category: 'DELIVERY', subject: 'x', description: 'y', orderId });
    const after = await DeliveryPartner.findById(riderId).lean();
    expect(after.availability).toBe(before.availability);
    expect(after.accountStatus).toBe(before.accountStatus);
  });
});
