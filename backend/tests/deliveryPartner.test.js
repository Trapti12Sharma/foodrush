require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const DeliveryPartner = require('../src/models/DeliveryPartner');

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';

function validPayload(overrides = {}) {
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
      identityProofUrl: DOC_URL,
      profilePhotoUrl: DOC_URL,
      drivingLicenceUrl: DOC_URL,
      vehicleRegistrationUrl: DOC_URL,
    },
    ...overrides,
  };
}

async function registerPartner(prefix) {
  return registerAndLogin({ name: 'Rider', email: uniqueEmail(prefix), role: 'DELIVERY_PARTNER' });
}

// Registers, submits KYC and gets admin-approved in one go, ready for the
// online/offline and location tests.
async function approvedPartner(prefix, admin) {
  const partner = await registerPartner(prefix);
  const created = await partner.post('/api/delivery-partners').send(validPayload());
  await admin.patch(`/api/admin/delivery-partners/${created.body.data.deliveryPartner._id}/approve-kyc`);
  return partner;
}

describe('Delivery partner registration', () => {
  it('creates a profile, submitted for KYC review, starting PENDING account status', async () => {
    const partner = await registerPartner('dp-reg');
    const res = await partner.post('/api/delivery-partners').send(validPayload());
    expect(res.status).toBe(201);
    expect(res.body.data.deliveryPartner.kycStatus).toBe('SUBMITTED');
    expect(res.body.data.deliveryPartner.accountStatus).toBe('PENDING');
    expect(res.body.data.deliveryPartner.availability).toBe('OFFLINE');
  });

  it('rejects a duplicate registration for the same account', async () => {
    const partner = await registerPartner('dp-dup');
    expect((await partner.post('/api/delivery-partners').send(validPayload())).status).toBe(201);
    const second = await partner.post('/api/delivery-partners').send(validPayload());
    expect(second.status).toBe(409);
  });

  it('does not require a driving licence/vehicle number/registration for a bicycle', async () => {
    const partner = await registerPartner('dp-cycle');
    const res = await partner.post('/api/delivery-partners').send(
      validPayload({
        vehicleType: 'BICYCLE',
        vehicleNumber: undefined,
        drivingLicenceNumber: undefined,
        drivingLicenceExpiry: undefined,
        documents: { identityProofUrl: DOC_URL, profilePhotoUrl: DOC_URL },
      })
    );
    expect(res.status).toBe(201);
  });

  it('requires the driving licence and vehicle registration photos for a motorised vehicle', async () => {
    const partner = await registerPartner('dp-missingdocs');
    const res = await partner.post('/api/delivery-partners').send(
      validPayload({ documents: { identityProofUrl: DOC_URL, profilePhotoUrl: DOC_URL } })
    );
    expect(res.status).toBe(422);
  });

  it('rejects a driving licence number that is obviously not one', async () => {
    const partner = await registerPartner('dp-badlicence');
    const res = await partner.post('/api/delivery-partners').send(validPayload({ drivingLicenceNumber: 'asdkfj' }));
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain('drivingLicenceNumber');
  });

  it('rejects a driving licence that has already expired', async () => {
    const partner = await registerPartner('dp-expiredlicence');
    const res = await partner.post('/api/delivery-partners').send(validPayload({ drivingLicenceExpiry: '2020-01-01' }));
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain('drivingLicenceExpiry');
  });

  it('rejects a pincode that is not a real 6-digit Indian pincode', async () => {
    const partner = await registerPartner('dp-badpincode');
    const res = await partner
      .post('/api/delivery-partners')
      .send(validPayload({ address: { addressLine: '1 Rider Lane', pincode: '12345' } }));
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain('address.pincode');
  });

  it('rejects a rider under the minimum age, and accepts one who clears it', async () => {
    const tooYoung = await registerPartner('dp-tooyoung');
    const underage = new Date();
    underage.setFullYear(underage.getFullYear() - 15);
    const res = await tooYoung.post('/api/delivery-partners').send(validPayload({ dateOfBirth: underage.toISOString().slice(0, 10) }));
    expect(res.status).toBe(422);
    expect(res.body.errors.map((e) => e.field)).toContain('dateOfBirth');

    const oldEnough = await registerPartner('dp-oldenough');
    const adult = new Date();
    adult.setFullYear(adult.getFullYear() - 25);
    const ok = await oldEnough.post('/api/delivery-partners').send(validPayload({ dateOfBirth: adult.toISOString().slice(0, 10) }));
    expect(ok.status).toBe(201);
  });

  it('rejects an unauthenticated registration attempt', async () => {
    const { app } = require('./helpers');
    const request = require('supertest');
    const res = await request(app).post('/api/delivery-partners').send(validPayload());
    expect(res.status).toBe(401);
  });

  it('does not let a customer register as a delivery partner', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('dp-cust-reg'), role: 'CUSTOMER' });
    const res = await customer.post('/api/delivery-partners').send(validPayload());
    expect(res.status).toBe(403);
  });
});

describe('Delivery partner own-profile access', () => {
  it('returns 404 before a profile is created, then the profile after', async () => {
    const partner = await registerPartner('dp-me');
    expect((await partner.get('/api/delivery-partners/me')).status).toBe(404);
    await partner.post('/api/delivery-partners').send(validPayload());
    const res = await partner.get('/api/delivery-partners/me');
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.fullName).toBe('Test Rider');
  });

  it('updates allowed profile/vehicle fields', async () => {
    const partner = await registerPartner('dp-update');
    await partner.post('/api/delivery-partners').send(validPayload());
    const res = await partner.put('/api/delivery-partners/me').send({ fullName: 'Updated Name', city: 'Mumbai' });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.fullName).toBe('Updated Name');
    expect(res.body.data.deliveryPartner.city).toBe('Mumbai');
  });

  it('merges a partial documents update instead of wiping the others', async () => {
    const partner = await registerPartner('dp-docmerge');
    await partner.post('/api/delivery-partners').send(validPayload());
    const NEW_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/new123.jpg';
    const res = await partner.put('/api/delivery-partners/me').send({ documents: { profilePhotoUrl: NEW_URL } });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.documents.profilePhotoUrl).toBe(NEW_URL);
    expect(res.body.data.deliveryPartner.documents.drivingLicenceUrl).toBe(DOC_URL); // untouched
    expect(res.body.data.deliveryPartner.documents.vehicleRegistrationUrl).toBe(DOC_URL); // untouched
  });

  it('cannot modify its own role via the profile-update endpoint', async () => {
    const partner = await registerPartner('dp-role');
    await partner.post('/api/delivery-partners').send(validPayload());
    await partner.put('/api/delivery-partners/me').send({ role: 'ADMIN' });
    const me = await partner.get('/api/auth/me');
    expect(me.body.data.user.role).toBe('DELIVERY_PARTNER');
  });

  it('cannot modify its own KYC status or account status via the profile-update endpoint', async () => {
    const partner = await registerPartner('dp-kycmod');
    await partner.post('/api/delivery-partners').send(validPayload());
    const res = await partner.put('/api/delivery-partners/me').send({ kycStatus: 'VERIFIED', accountStatus: 'ACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.kycStatus).toBe('SUBMITTED'); // unchanged
    expect(res.body.data.deliveryPartner.accountStatus).toBe('PENDING'); // unchanged
  });
});

describe('Admin KYC approval', () => {
  it('approves KYC, activating the account', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await registerPartner('dp-approve');
    const created = await partner.post('/api/delivery-partners').send(validPayload());
    const id = created.body.data.deliveryPartner._id;

    const res = await admin.patch(`/api/admin/delivery-partners/${id}/approve-kyc`);
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.kycStatus).toBe('VERIFIED');
    expect(res.body.data.deliveryPartner.accountStatus).toBe('ACTIVE');

    const stored = await DeliveryPartner.findById(id);
    expect(stored.kycReviewedBy).toBeTruthy();
    expect(stored.kycReviewedAt).toBeTruthy();
  });

  it('rejects KYC with a reason, also rejecting the account', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await registerPartner('dp-reject');
    const created = await partner.post('/api/delivery-partners').send(validPayload());
    const id = created.body.data.deliveryPartner._id;

    const missingReason = await admin.patch(`/api/admin/delivery-partners/${id}/reject-kyc`).send({});
    expect(missingReason.status).toBe(422);

    const res = await admin.patch(`/api/admin/delivery-partners/${id}/reject-kyc`).send({ reason: 'Blurry licence photo' });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.kycStatus).toBe('REJECTED');
    expect(res.body.data.deliveryPartner.accountStatus).toBe('REJECTED');
    expect(res.body.data.deliveryPartner.kycRejectionReason).toBe('Blurry licence photo');
  });

  it('refuses to approve/reject KYC that is not currently SUBMITTED', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await registerPartner('dp-double');
    const created = await partner.post('/api/delivery-partners').send(validPayload());
    const id = created.body.data.deliveryPartner._id;
    await admin.patch(`/api/admin/delivery-partners/${id}/approve-kyc`);

    expect((await admin.patch(`/api/admin/delivery-partners/${id}/approve-kyc`)).status).toBe(400);
    expect((await admin.patch(`/api/admin/delivery-partners/${id}/reject-kyc`).send({ reason: 'x' })).status).toBe(400);
  });

  it('a delivery partner cannot approve or reject their own KYC', async () => {
    const partner = await registerPartner('dp-self-approve');
    const created = await partner.post('/api/delivery-partners').send(validPayload());
    const id = created.body.data.deliveryPartner._id;

    expect((await partner.patch(`/api/admin/delivery-partners/${id}/approve-kyc`)).status).toBe(403);
    expect((await partner.patch(`/api/admin/delivery-partners/${id}/reject-kyc`).send({ reason: 'x' })).status).toBe(403);
  });

  it('a plain customer cannot access any admin delivery-partner endpoint', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('dp-cust-admin'), role: 'CUSTOMER' });
    const partner = await registerPartner('dp-cust-target');
    const created = await partner.post('/api/delivery-partners').send(validPayload());
    const id = created.body.data.deliveryPartner._id;

    expect((await customer.get('/api/admin/delivery-partners')).status).toBe(403);
    expect((await customer.get(`/api/admin/delivery-partners/${id}`)).status).toBe(403);
    expect((await customer.patch(`/api/admin/delivery-partners/${id}/approve-kyc`)).status).toBe(403);
  });

  it('rejects an unauthenticated request to the admin delivery-partner list', async () => {
    const { app } = require('./helpers');
    const request = require('supertest');
    const res = await request(app).get('/api/admin/delivery-partners');
    expect(res.status).toBe(401);
  });

  it('hides documents/DOB/licence number/emergency contact from the list endpoint but shows them in the detail endpoint', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await registerPartner('dp-listhide');
    const created = await partner.post('/api/delivery-partners').send(validPayload({ dateOfBirth: '1995-05-05' }));
    const id = created.body.data.deliveryPartner._id;

    const list = await admin.get('/api/admin/delivery-partners');
    expect(list.status).toBe(200);
    const listed = list.body.data.deliveryPartners.find((p) => p._id === id);
    expect(listed.documents).toBeUndefined();
    expect(listed.dateOfBirth).toBeUndefined();
    expect(listed.drivingLicenceNumber).toBeUndefined();

    const detail = await admin.get(`/api/admin/delivery-partners/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.deliveryPartner.documents.identityProofUrl).toBe(DOC_URL);
    expect(detail.body.data.deliveryPartner.drivingLicenceNumber).toBe('DL123456789');
  });
});

describe('Suspend / reactivate', () => {
  it('suspends an active partner, who is immediately forced offline and cannot go online again', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await approvedPartner('dp-suspend', admin);
    await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });

    const idRes = await partner.get('/api/delivery-partners/me');
    const id = idRes.body.data.deliveryPartner._id;

    const res = await admin.patch(`/api/admin/delivery-partners/${id}/suspend`).send({ reason: 'Customer complaint' });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.accountStatus).toBe('SUSPENDED');
    expect(res.body.data.deliveryPartner.availability).toBe('OFFLINE');

    const goOnline = await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
    expect(goOnline.status).toBe(400);
  });

  it('reactivates a suspended, still-verified partner', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await approvedPartner('dp-reactivate', admin);
    const idRes = await partner.get('/api/delivery-partners/me');
    const id = idRes.body.data.deliveryPartner._id;
    await admin.patch(`/api/admin/delivery-partners/${id}/suspend`).send({ reason: 'x' });

    const res = await admin.patch(`/api/admin/delivery-partners/${id}/reactivate`);
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.accountStatus).toBe('ACTIVE');

    const goOnline = await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
    expect(goOnline.status).toBe(200);
  });

  it('refuses to suspend a partner who is not currently ACTIVE, and to reactivate one who is not currently SUSPENDED', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await registerPartner('dp-badtransition');
    const created = await partner.post('/api/delivery-partners').send(validPayload()); // still SUBMITTED/PENDING
    const id = created.body.data.deliveryPartner._id;

    expect((await admin.patch(`/api/admin/delivery-partners/${id}/suspend`)).status).toBe(400);
    expect((await admin.patch(`/api/admin/delivery-partners/${id}/reactivate`)).status).toBe(400);
  });
});

describe('Online / offline eligibility', () => {
  it('an unverified (freshly submitted) partner cannot go online', async () => {
    const partner = await registerPartner('dp-unverified');
    await partner.post('/api/delivery-partners').send(validPayload());
    const res = await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
    expect(res.status).toBe(400);
  });

  it('a rejected partner cannot go online', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await registerPartner('dp-rejectedonline');
    const created = await partner.post('/api/delivery-partners').send(validPayload());
    await admin.patch(`/api/admin/delivery-partners/${created.body.data.deliveryPartner._id}/reject-kyc`).send({ reason: 'x' });

    const res = await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
    expect(res.status).toBe(400);
  });

  it('an active, verified partner can go online, then offline', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await approvedPartner('dp-onoff', admin);

    const online = await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' });
    expect(online.status).toBe(200);
    expect(online.body.data.deliveryPartner.availability).toBe('ONLINE');

    const offline = await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'OFFLINE' });
    expect(offline.status).toBe(200);
    expect(offline.body.data.deliveryPartner.availability).toBe('OFFLINE');
  });

  it('rejects an invalid availability value', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await approvedPartner('dp-badavail', admin);
    const res = await partner.patch('/api/delivery-partners/me/availability').send({ availability: 'MAYBE' });
    expect(res.status).toBe(422);
  });
});

describe('Location foundation', () => {
  it('accepts a real latitude/longitude and records when it was last updated', async () => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await approvedPartner('dp-loc', admin);
    const res = await partner.patch('/api/delivery-partners/me/location').send({ latitude: 18.5204, longitude: 73.8567, accuracy: 15 });
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryPartner.currentLocation.coordinates).toEqual([73.8567, 18.5204]);
    expect(res.body.data.deliveryPartner.lastLocationAt).toBeTruthy();
  });

  it.each([
    [91, 73.8567],
    [-91, 73.8567],
    [18.5204, 181],
    [18.5204, -181],
    ['not-a-number', 73.8567],
  ])('rejects an invalid latitude/longitude pair (%p, %p)', async (latitude, longitude) => {
    const { agent: admin } = await createUserWithRole('ADMIN');
    const partner = await approvedPartner('dp-badloc', admin);
    const res = await partner.patch('/api/delivery-partners/me/location').send({ latitude, longitude });
    expect(res.status).toBe(422);
  });
});

describe('Existing flows are unaffected by this milestone', () => {
  it('customer registration, login and /auth/me still work', async () => {
    const email = uniqueEmail('dp-regress-cust');
    const agent = await registerAndLogin({ name: 'Still Works', email, role: 'CUSTOMER' });
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
  });

  it('the restaurant owner flow (create restaurant, category, food) still works', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('dp-regress-owner'), role: 'RESTAURANT_OWNER' });
    const { restaurant, food } = await setupOrderable(owner);
    expect(restaurant._id).toBeTruthy();
    expect(food._id).toBeTruthy();
  });

  it('a full customer order (place, no delivery partner involved) still works end to end', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('dp-regress-order-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail('dp-regress-order-c'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner, { price: 150 });
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });

    const res = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(res.status).toBe(201);
    expect(res.body.data.order.orderStatus).toBe('PLACED');
    expect(res.body.data.order.deliveryPartner).toBeFalsy(); // untouched by this milestone
  });
});
