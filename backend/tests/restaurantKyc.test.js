require('./setup');
const { registerAndLogin, uniqueEmail, createUserWithRole, submitRestaurantKyc, KYC_DOC_URL } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Notification = require('../src/models/Notification');
const { migrateRestaurantKyc } = require('../scripts/migrate-restaurant-kyc');

async function freshRestaurant(prefix) {
  const owner = await registerAndLogin({ name: 'O', email: uniqueEmail(`${prefix}-o`), role: 'RESTAURANT_OWNER' });
  const res = await owner.post('/api/restaurants').send({
    name: `KYC Kitchen ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
  });
  return { owner, restaurantId: res.body.data.restaurant._id };
}

describe('Restaurant KYC — submission', () => {
  it('a new restaurant starts NOT_SUBMITTED, and the owner can submit complete documents', async () => {
    const { owner, restaurantId } = await freshRestaurant('sub-ok');
    expect((await Restaurant.findById(restaurantId)).kycStatus).toBe('NOT_SUBMITTED');

    const res = await submitRestaurantKyc(owner, restaurantId);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.kycStatus).toBe('SUBMITTED');
    expect(res.body.data.restaurant.kycDocuments.fssaiLicenseNumber).toBe('12345678901234');

    const stored = await Restaurant.findById(restaurantId);
    expect(stored.kycSubmittedAt).toBeInstanceOf(Date);
    expect(stored.isApproved).toBe(false); // submitting never approves it
  });

  it('GST fields are optional', async () => {
    const { owner, restaurantId } = await freshRestaurant('sub-nogst');
    const res = await owner.post(`/api/restaurants/${restaurantId}/kyc/submit`).send({
      fssaiLicenseNumber: '111', fssaiCertificateUrl: KYC_DOC_URL, panNumber: 'AAAAA1111A', panCardUrl: KYC_DOC_URL, ownerIdentityProofUrl: KYC_DOC_URL,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.kycDocuments.gstNumber).toBe('');
  });

  it('rejects a submission missing any required document', async () => {
    const { owner, restaurantId } = await freshRestaurant('sub-missing');
    const res = await owner.post(`/api/restaurants/${restaurantId}/kyc/submit`).send({ fssaiLicenseNumber: '111' });
    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['fssaiCertificateUrl', 'panNumber', 'panCardUrl', 'ownerIdentityProofUrl']));
  });

  it('rejects an unsafe URL for a document field', async () => {
    const { owner, restaurantId } = await freshRestaurant('sub-unsafe');
    const res = await owner.post(`/api/restaurants/${restaurantId}/kyc/submit`).send({
      fssaiLicenseNumber: '111', fssaiCertificateUrl: 'javascript:alert(1)', panNumber: 'AAAAA1111A', panCardUrl: KYC_DOC_URL, ownerIdentityProofUrl: KYC_DOC_URL,
    });
    expect(res.status).toBe(422);
  });

  it('cannot resubmit while already SUBMITTED (awaiting review)', async () => {
    const { owner, restaurantId } = await freshRestaurant('sub-twice');
    await submitRestaurantKyc(owner, restaurantId).expect(200);
    const again = await submitRestaurantKyc(owner, restaurantId);
    expect(again.status).toBe(400);
  });

  it('a different owner cannot submit KYC for someone else\'s restaurant', async () => {
    const { restaurantId } = await freshRestaurant('sub-stranger');
    const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('sub-stranger2'), role: 'RESTAURANT_OWNER' });
    const res = await submitRestaurantKyc(stranger, restaurantId);
    expect(res.status).toBe(403);
  });

  it('a customer cannot submit KYC, and an unauthenticated caller gets 401', async () => {
    const { restaurantId } = await freshRestaurant('sub-cust');
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('sub-cust2'), role: 'CUSTOMER' });
    expect((await submitRestaurantKyc(customer, restaurantId)).status).toBe(403);
    const { app } = require('./helpers');
    const request = require('supertest');
    expect((await request(app).post(`/api/restaurants/${restaurantId}/kyc/submit`).send({})).status).toBe(401);
  });

  it('returns 404 for an unknown restaurant id', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('sub-404'), role: 'RESTAURANT_OWNER' });
    expect((await submitRestaurantKyc(owner, '507f1f77bcf86cd799439011')).status).toBe(404);
  });

  it('an admin can submit KYC on the owner\'s behalf', async () => {
    const { restaurantId } = await freshRestaurant('sub-admin');
    const { agent: admin } = await createUserWithRole('ADMIN');
    expect((await submitRestaurantKyc(admin, restaurantId)).status).toBe(200);
  });

  it('notifies every admin who can approve restaurants when KYC is submitted', async () => {
    const { owner, restaurantId } = await freshRestaurant('sub-notify');
    const { user: adminUser } = await createUserWithRole('ADMIN');
    await submitRestaurantKyc(owner, restaurantId).expect(200);
    expect(await Notification.findOne({ recipient: adminUser._id, type: 'RESTAURANT_KYC_SUBMITTED' })).toBeTruthy();
  });
});

describe('Restaurant KYC — admin approve/reject', () => {
  it('cannot approve before KYC has been submitted', async () => {
    const { restaurantId } = await freshRestaurant('app-early');
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`);
    expect(res.status).toBe(400);
    expect((await Restaurant.findById(restaurantId)).isApproved).toBe(false);
  });

  it('approves in one step: kycStatus -> VERIFIED and isApproved -> true, with reviewer recorded', async () => {
    const { owner, restaurantId } = await freshRestaurant('app-ok');
    const { agent: admin, user: adminUser } = await createUserWithRole('ADMIN');
    await submitRestaurantKyc(owner, restaurantId).expect(200);

    const res = await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.kycStatus).toBe('VERIFIED');
    expect(res.body.data.restaurant.isApproved).toBe(true);

    const stored = await Restaurant.findById(restaurantId);
    expect(stored.kycReviewedBy.toString()).toBe(adminUser._id.toString());
    expect(stored.kycReviewedAt).toBeInstanceOf(Date);
  });

  it('notifies the owner when their restaurant is verified', async () => {
    const { owner, restaurantId } = await freshRestaurant('app-notify');
    const { agent: admin } = await createUserWithRole('ADMIN');
    const me = await owner.get('/api/auth/me');
    await submitRestaurantKyc(owner, restaurantId).expect(200);
    await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`).expect(200);
    expect(await Notification.findOne({ recipient: me.body.data.user._id, type: 'RESTAURANT_KYC_VERIFIED' })).toBeTruthy();
  });

  it('rejecting requires a reason, only works from SUBMITTED, and never touches isApproved', async () => {
    const { owner, restaurantId } = await freshRestaurant('rej-ok');
    const { agent: admin } = await createUserWithRole('ADMIN');

    const tooEarly = await admin.patch(`/api/admin/restaurants/${restaurantId}/reject-kyc`).send({ reason: 'x' });
    expect(tooEarly.status).toBe(400);

    await submitRestaurantKyc(owner, restaurantId).expect(200);
    const missingReason = await admin.patch(`/api/admin/restaurants/${restaurantId}/reject-kyc`).send({});
    expect(missingReason.status).toBe(422);

    const res = await admin.patch(`/api/admin/restaurants/${restaurantId}/reject-kyc`).send({ reason: 'FSSAI certificate is expired' });
    expect(res.status).toBe(200);
    expect(res.body.data.restaurant.kycStatus).toBe('REJECTED');
    expect(res.body.data.restaurant.kycRejectionReason).toBe('FSSAI certificate is expired');
    expect(res.body.data.restaurant.isApproved).toBe(false);
  });

  it('notifies the owner when KYC is rejected, with the reason', async () => {
    const { owner, restaurantId } = await freshRestaurant('rej-notify');
    const { agent: admin } = await createUserWithRole('ADMIN');
    const me = await owner.get('/api/auth/me');
    await submitRestaurantKyc(owner, restaurantId).expect(200);
    await admin.patch(`/api/admin/restaurants/${restaurantId}/reject-kyc`).send({ reason: 'Blurry PAN card' }).expect(200);
    const notif = await Notification.findOne({ recipient: me.body.data.user._id, type: 'RESTAURANT_KYC_REJECTED' });
    expect(notif).toBeTruthy();
    expect(notif.data.reason).toBe('Blurry PAN card');
  });

  it('after rejection, the owner can fix and resubmit, and the admin can then approve', async () => {
    const { owner, restaurantId } = await freshRestaurant('rej-resub');
    const { agent: admin } = await createUserWithRole('ADMIN');
    await submitRestaurantKyc(owner, restaurantId).expect(200);
    await admin.patch(`/api/admin/restaurants/${restaurantId}/reject-kyc`).send({ reason: 'fix it' }).expect(200);

    const resubmit = await submitRestaurantKyc(owner, restaurantId);
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.restaurant.kycStatus).toBe('SUBMITTED');
    expect(resubmit.body.data.restaurant.kycRejectionReason).toBeNull(); // cleared on resubmission

    const approved = await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.restaurant.isApproved).toBe(true);
  });

  it('a restaurant already live can resubmit KYC (e.g. renewing a licence) without ever going offline', async () => {
    const { owner, restaurantId } = await freshRestaurant('renew');
    const { agent: admin } = await createUserWithRole('ADMIN');
    await submitRestaurantKyc(owner, restaurantId).expect(200);
    await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`).expect(200);

    const renewal = await submitRestaurantKyc(owner, restaurantId);
    expect(renewal.status).toBe(200);
    expect(renewal.body.data.restaurant.kycStatus).toBe('SUBMITTED');
    expect(renewal.body.data.restaurant.isApproved).toBe(true); // still live throughout

    // And rejecting the renewal still doesn't take it offline.
    await admin.patch(`/api/admin/restaurants/${restaurantId}/reject-kyc`).send({ reason: 'renewal docs unclear' }).expect(200);
    expect((await Restaurant.findById(restaurantId)).isApproved).toBe(true);
  });

  it('a customer/restaurant owner cannot approve or reject KYC; unauthenticated is 401', async () => {
    const { owner, restaurantId } = await freshRestaurant('rbac');
    const otherOwner = await registerAndLogin({ name: 'O2', email: uniqueEmail('rbac-o2'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('rbac-c'), role: 'CUSTOMER' });
    await submitRestaurantKyc(owner, restaurantId).expect(200);

    expect((await otherOwner.patch(`/api/admin/restaurants/${restaurantId}/approve`)).status).toBe(403);
    expect((await customer.patch(`/api/admin/restaurants/${restaurantId}/approve`)).status).toBe(403);
    expect((await customer.patch(`/api/admin/restaurants/${restaurantId}/reject-kyc`).send({ reason: 'x' })).status).toBe(403);

    const { app } = require('./helpers');
    const request = require('supertest');
    expect((await request(app).patch(`/api/admin/restaurants/${restaurantId}/approve`)).status).toBe(401);
  });

  it('filters the admin restaurant listing by kycStatus', async () => {
    const { owner: submittedOwner, restaurantId: submittedId } = await freshRestaurant('filter-sub');
    await freshRestaurant('filter-notsub'); // stays NOT_SUBMITTED
    await submitRestaurantKyc(submittedOwner, submittedId).expect(200);
    const { agent: admin } = await createUserWithRole('ADMIN');

    const submitted = await admin.get('/api/admin/restaurants').query({ kycStatus: 'SUBMITTED' });
    expect(submitted.body.data.restaurants.map((r) => r._id)).toContain(submittedId);
    expect(submitted.body.data.restaurants.every((r) => r.kycStatus === 'SUBMITTED')).toBe(true);
  });
});

describe('Restaurant KYC — backfill migration', () => {
  it('leaves a restaurant that already has a kycStatus completely untouched', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('mig-untouched'), role: 'RESTAURANT_OWNER' });
    const res = await owner.post('/api/restaurants').send({ name: 'Already Migrated', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20 });
    const id = res.body.data.restaurant._id;
    // Already went through the real flow — has an explicit kycStatus, same as any post-M14 restaurant.
    expect((await Restaurant.findById(id)).kycStatus).toBe('NOT_SUBMITTED');

    const summary = await migrateRestaurantKyc({ apply: true });
    expect(summary.toUpdate).toBe(0);
    expect((await Restaurant.findById(id)).kycStatus).toBe('NOT_SUBMITTED');
  });

  it('backfills a pre-M14 restaurant: VERIFIED if already approved, NOT_SUBMITTED otherwise — dry run changes nothing', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('mig-owner'), role: 'RESTAURANT_OWNER' });
    const ownerId = (await owner.get('/api/auth/me')).body.data.user._id;

    // Simulate documents written before M14 — no kycStatus field at all — via a
    // raw collection write (Mongoose would otherwise apply the schema default).
    const approvedId = (await Restaurant.collection.insertOne({
      name: 'Legacy Approved', owner: require('mongoose').Types.ObjectId.createFromHexString(ownerId),
      cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
      isApproved: true, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    })).insertedId;
    const pendingId = (await Restaurant.collection.insertOne({
      name: 'Legacy Pending', owner: require('mongoose').Types.ObjectId.createFromHexString(ownerId),
      cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
      isApproved: false, isActive: true, createdAt: new Date(), updatedAt: new Date(),
    })).insertedId;

    const dryRun = await migrateRestaurantKyc({ apply: false });
    expect(dryRun.toUpdate).toBeGreaterThanOrEqual(2);
    expect((await Restaurant.collection.findOne({ _id: approvedId })).kycStatus).toBeUndefined(); // untouched by dry run

    const applied = await migrateRestaurantKyc({ apply: true });
    expect(applied.updated).toBeGreaterThanOrEqual(2);
    expect((await Restaurant.findById(approvedId)).kycStatus).toBe('VERIFIED');
    expect((await Restaurant.findById(pendingId)).kycStatus).toBe('NOT_SUBMITTED');
    expect((await Restaurant.findById(approvedId)).isApproved).toBe(true); // isApproved itself never touched

    // Idempotent — a second apply run touches nothing further.
    const second = await migrateRestaurantKyc({ apply: true });
    expect(second.toUpdate).toBe(0);
  });
});
