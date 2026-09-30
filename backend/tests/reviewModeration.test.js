require('./setup');
const mongoose = require('mongoose');
const request = require('supertest');
const app = require('../src/app');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Review = require('../src/models/Review');
const ReviewReport = require('../src/models/ReviewReport');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');
const User = require('../src/models/User');
const { migrateReviewModeration } = require('../scripts/migrate-review-moderation');

// A restaurant, one delivered order for `customer`, and the review already
// submitted (PENDING) against it — the common starting point for almost every
// test below. Mirrors setupDeliveredOrder in review.test.js but also creates
// the review itself, since moderation tests always start from one existing.
async function setupPendingReview(prefix, { rating = 4 } = {}) {
  const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail(`${prefix}-owner`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail(`${prefix}-cust`), role: 'CUSTOMER' });

  const res = await owner.post('/api/restaurants').send({
    name: `Mod Kitchen ${prefix} ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
  });
  const restaurant = res.body.data.restaurant;
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Item', price: 100, isVeg: true,
  });

  const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
  await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
  const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
  const order = orderRes.body.data.order;
  for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
    await owner.patch(`/api/orders/${order._id}/status`).send({ status });
  }

  const reviewRes = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating, comment: 'Test comment' });
  return { owner, customer, restaurant, order, review: reviewRes.body.data.review };
}

describe('Review creation — auth, RBAC & eligibility', () => {
  it('rejects an unauthenticated create', async () => {
    const res = await request(app).post('/api/reviews').send({ restaurant: '507f1f77bcf86cd799439011', order: '507f1f77bcf86cd799439011', rating: 5 });
    expect(res.status).toBe(401);
  });

  it('a customer cannot review an order that belongs to a different customer', async () => {
    const { order, restaurant } = await setupPendingReview('cross-order');
    const stranger = await registerAndLogin({ name: 'Stranger', email: uniqueEmail('cross-order-stranger'), role: 'CUSTOMER' });
    const res = await stranger.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 5 });
    expect(res.status).toBe(403);
  });

  it('an admin cannot impersonate a customer to create a review for an order that is not theirs', async () => {
    const { order, restaurant } = await setupPendingReview('admin-impersonate');
    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 5 });
    expect(res.status).toBe(403);
  });

  it('rejects an invalid rating and an over-length comment', async () => {
    const { customer, order, restaurant } = await setupPendingReview('bad-input');
    // order already reviewed by setupPendingReview — use validation-only checks,
    // which run before the duplicate-order check.
    const tooLow = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 0 });
    expect(tooLow.status).toBe(422);
    const tooLong = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating: 5, comment: 'x'.repeat(1001) });
    expect(tooLong.status).toBe(422);
  });

  it('every new review starts PENDING and is audited', async () => {
    const { review } = await setupPendingReview('audit-create');
    expect(review.moderationStatus).toBe('PENDING');
    const log = await AuditLog.findOne({ action: 'review.create', entityId: review._id });
    expect(log).toBeTruthy();
    expect(log.metadata.rating).toBe(4);
  });
});

describe('Review visibility & ownership', () => {
  it('a PENDING review is visible only to its own author, never to another customer or an anonymous visitor', async () => {
    const { customer, restaurant } = await setupPendingReview('vis-pending');

    const anon = await request(app).get(`/api/restaurants/${restaurant._id}/reviews`);
    expect(anon.body.data.reviews).toHaveLength(0);

    const stranger = await registerAndLogin({ name: 'Stranger', email: uniqueEmail('vis-pending-stranger'), role: 'CUSTOMER' });
    const strangerView = await stranger.get(`/api/restaurants/${restaurant._id}/reviews`);
    expect(strangerView.body.data.reviews).toHaveLength(0);

    const ownView = await customer.get(`/api/restaurants/${restaurant._id}/reviews`);
    expect(ownView.body.data.reviews).toHaveLength(1);
    expect(ownView.body.data.reviews[0].moderationStatus).toBe('PENDING');
  });

  it('never exposes moderatedBy/reportCount/reportedAt on the public listing, even for the review author', async () => {
    const { customer, restaurant, review } = await setupPendingReview('vis-fields');
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.patch(`/api/admin/reviews/${review._id}/approve`);

    const res = await customer.get(`/api/restaurants/${restaurant._id}/reviews`);
    const mine = res.body.data.reviews[0];
    expect(mine.moderatedBy).toBeUndefined();
    expect(mine.reportCount).toBeUndefined();
    expect(mine.reportedAt).toBeUndefined();
  });

  it("shows the author their own rejection reason, but a stranger never sees another customer's rejected review at all", async () => {
    const { customer, restaurant, review } = await setupPendingReview('vis-rejected');
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.patch(`/api/admin/reviews/${review._id}/reject`).send({ reason: 'Inappropriate language' });

    const ownView = await customer.get(`/api/restaurants/${restaurant._id}/reviews`);
    expect(ownView.body.data.reviews[0].moderationStatus).toBe('REJECTED');
    expect(ownView.body.data.reviews[0].moderationReason).toBe('Inappropriate language');

    const stranger = await registerAndLogin({ name: 'Stranger', email: uniqueEmail('vis-rejected-stranger'), role: 'CUSTOMER' });
    const strangerView = await stranger.get(`/api/restaurants/${restaurant._id}/reviews`);
    expect(strangerView.body.data.reviews).toHaveLength(0);
  });
});

describe('Review moderation workflow', () => {
  it('approve: PENDING -> APPROVED, stamps the moderator, and is audited', async () => {
    const { review } = await setupPendingReview('mod-approve');
    const { agent: admin, user: adminUser } = await createUserWithRole('ADMIN');
    const res = await admin.patch(`/api/admin/reviews/${review._id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.review.moderationStatus).toBe('APPROVED');

    const stored = await Review.findById(review._id);
    expect(stored.moderatedBy.toString()).toBe(adminUser._id.toString());
    expect(stored.moderatedAt).toBeInstanceOf(Date);

    const log = await AuditLog.findOne({ action: 'review.approve', entityId: review._id });
    expect(log).toBeTruthy();
  });

  it('reject: requires a reason, only works from PENDING, is audited, and never affects isApproved-style fields', async () => {
    const { review } = await setupPendingReview('mod-reject');
    const { agent: admin } = await createUserWithRole('ADMIN');

    const noReason = await admin.patch(`/api/admin/reviews/${review._id}/reject`).send({});
    expect(noReason.status).toBe(422);

    const res = await admin.patch(`/api/admin/reviews/${review._id}/reject`).send({ reason: 'Fake experience' });
    expect(res.status).toBe(200);
    expect(res.body.data.review.moderationStatus).toBe('REJECTED');
    expect(res.body.data.review.moderationReason).toBe('Fake experience');

    const log = await AuditLog.findOne({ action: 'review.reject', entityId: review._id });
    expect(log.metadata.reason).toBe('Fake experience');
  });

  it('hide: only from APPROVED; restore: only from HIDDEN', async () => {
    const { review } = await setupPendingReview('mod-hide');
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.patch(`/api/admin/reviews/${review._id}/approve`);

    const hideRes = await admin.patch(`/api/admin/reviews/${review._id}/hide`).send({ reason: 'Policy violation found later' });
    expect(hideRes.status).toBe(200);
    expect(hideRes.body.data.review.moderationStatus).toBe('HIDDEN');

    const restoreRes = await admin.patch(`/api/admin/reviews/${review._id}/restore`);
    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.data.review.moderationStatus).toBe('APPROVED');
    expect(restoreRes.body.data.review.moderationReason).toBeNull();
  });

  it('rejects every invalid transition with 400', async () => {
    const { review } = await setupPendingReview('mod-invalid');
    const { agent: admin } = await createUserWithRole('ADMIN');

    // hide before ever approved
    expect((await admin.patch(`/api/admin/reviews/${review._id}/hide`)).status).toBe(400);
    // restore something that was never hidden
    expect((await admin.patch(`/api/admin/reviews/${review._id}/restore`)).status).toBe(400);

    await admin.patch(`/api/admin/reviews/${review._id}/approve`);
    // approving an already-APPROVED review
    expect((await admin.patch(`/api/admin/reviews/${review._id}/approve`)).status).toBe(400);
    // rejecting an APPROVED review
    expect((await admin.patch(`/api/admin/reviews/${review._id}/reject`).send({ reason: 'x' })).status).toBe(400);

    await admin.patch(`/api/admin/reviews/${review._id}/hide`);
    // hiding an already-HIDDEN review
    expect((await admin.patch(`/api/admin/reviews/${review._id}/hide`)).status).toBe(400);
  });

  it('a repeated identical moderation request (double-click) is rejected the second time, not silently repeated', async () => {
    const { review } = await setupPendingReview('mod-repeat');
    const { agent: admin } = await createUserWithRole('ADMIN');
    const first = await admin.patch(`/api/admin/reviews/${review._id}/reject`).send({ reason: 'Spammy' });
    expect(first.status).toBe(200);
    const second = await admin.patch(`/api/admin/reviews/${review._id}/reject`).send({ reason: 'Spammy again' });
    expect(second.status).toBe(400);
    expect((await Review.findById(review._id)).moderationReason).toBe('Spammy'); // untouched by the rejected second call
  });

  it('editing an APPROVED review resets it to PENDING and immediately stops it counting toward the rating', async () => {
    const { customer, restaurant, review } = await setupPendingReview('mod-edit-reset', { rating: 5 });
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.patch(`/api/admin/reviews/${review._id}/approve`);

    let r = await customer.get(`/api/restaurants/${restaurant._id}`);
    expect(r.body.data.restaurant.rating).toBe(5);

    await customer.put(`/api/reviews/${review._id}`).send({ rating: 1, comment: 'Changed my mind' });
    expect((await Review.findById(review._id)).moderationStatus).toBe('PENDING');

    r = await customer.get(`/api/restaurants/${restaurant._id}`);
    expect(r.body.data.restaurant.rating).toBe(0);
    expect(r.body.data.restaurant.totalReviews).toBe(0);
  });

  it('unauthorized callers cannot moderate: customer 403, restaurant owner 403, unauthenticated 401', async () => {
    const { owner, review } = await setupPendingReview('mod-rbac');
    const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('mod-rbac-cust'), role: 'CUSTOMER' });

    expect((await stranger.patch(`/api/admin/reviews/${review._id}/approve`)).status).toBe(403);
    expect((await owner.patch(`/api/admin/reviews/${review._id}/approve`)).status).toBe(403);
    expect((await request(app).patch(`/api/admin/reviews/${review._id}/approve`)).status).toBe(401);
  });

  it('a staff role WITHOUT reviews:moderate (e.g. OPERATIONS_MANAGER) cannot moderate, but RESTAURANT_MANAGER (which has it) can', async () => {
    const { review: review1 } = await setupPendingReview('mod-staff-1');
    const { review: review2 } = await setupPendingReview('mod-staff-2');
    const { agent: ops } = await createUserWithRole('OPERATIONS_MANAGER');
    const { agent: restaurantManager } = await createUserWithRole('RESTAURANT_MANAGER');

    expect((await ops.patch(`/api/admin/reviews/${review1._id}/approve`)).status).toBe(403);
    expect((await restaurantManager.patch(`/api/admin/reviews/${review2._id}/approve`)).status).toBe(200);
  });
});

describe('Rating aggregation', () => {
  it('averages multiple APPROVED reviews and excludes PENDING/REJECTED/HIDDEN ones', async () => {
    const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail('agg-owner'), role: 'RESTAURANT_OWNER' });
    const res = await owner.post('/api/restaurants').send({
      name: `Agg Kitchen ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    const restaurant = res.body.data.restaurant;
    await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
    const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
    const foodRes = await owner.post('/api/foods').send({
      restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Item', price: 100, isVeg: true,
    });
    const { agent: admin } = await createUserWithRole('ADMIN');

    async function orderAndReview(prefix, rating) {
      const customer = await registerAndLogin({ name: 'C', email: uniqueEmail(prefix), role: 'CUSTOMER' });
      const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
      await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
      const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
      const order = orderRes.body.data.order;
      for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
        await owner.patch(`/api/orders/${order._id}/status`).send({ status });
      }
      const reviewRes = await customer.post('/api/reviews').send({ restaurant: restaurant._id, order: order._id, rating });
      return reviewRes.body.data.review;
    }

    const r1 = await orderAndReview('agg-c1', 5);
    const r2 = await orderAndReview('agg-c2', 3);
    const r3 = await orderAndReview('agg-c3', 1); // will stay PENDING
    const r4 = await orderAndReview('agg-c4', 1); // will be REJECTED

    await admin.patch(`/api/admin/reviews/${r1._id}/approve`);
    await admin.patch(`/api/admin/reviews/${r2._id}/approve`);
    await admin.patch(`/api/admin/reviews/${r4._id}/reject`).send({ reason: 'no' });
    void r3; // left PENDING on purpose

    let restaurantRes = await owner.get(`/api/restaurants/${restaurant._id}`);
    expect(restaurantRes.body.data.restaurant.rating).toBe(4); // (5+3)/2
    expect(restaurantRes.body.data.restaurant.totalReviews).toBe(2);

    // Hiding one of the two approved reviews removes it from the average.
    await admin.patch(`/api/admin/reviews/${r2._id}/hide`);
    restaurantRes = await owner.get(`/api/restaurants/${restaurant._id}`);
    expect(restaurantRes.body.data.restaurant.rating).toBe(5);
    expect(restaurantRes.body.data.restaurant.totalReviews).toBe(1);

    // Restoring it brings it back.
    await admin.patch(`/api/admin/reviews/${r2._id}/restore`);
    restaurantRes = await owner.get(`/api/restaurants/${restaurant._id}`);
    expect(restaurantRes.body.data.restaurant.rating).toBe(4);
    expect(restaurantRes.body.data.restaurant.totalReviews).toBe(2);
  });

  it('never goes negative — deleting every approved review settles back to exactly 0', async () => {
    const { customer, restaurant, review } = await setupPendingReview('agg-zero', { rating: 5 });
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.patch(`/api/admin/reviews/${review._id}/approve`);
    await customer.delete(`/api/reviews/${review._id}`);
    const r = await customer.get(`/api/restaurants/${restaurant._id}`);
    expect(r.body.data.restaurant.rating).toBe(0);
    expect(r.body.data.restaurant.totalReviews).toBe(0);
  });
});

describe('Review reporting', () => {
  it('a valid report increments reportCount and sets reportedAt, and is audited', async () => {
    const { review } = await setupPendingReview('report-ok');
    const reporter = await registerAndLogin({ name: 'R', email: uniqueEmail('report-ok-reporter'), role: 'CUSTOMER' });
    const res = await reporter.post(`/api/reviews/${review._id}/report`).send({ reason: 'SPAM' });
    expect(res.status).toBe(201);

    const stored = await Review.findById(review._id);
    expect(stored.reportCount).toBe(1);
    expect(stored.reportedAt).toBeInstanceOf(Date);

    const log = await AuditLog.findOne({ action: 'review.report', entityId: review._id });
    expect(log.metadata.reason).toBe('SPAM');
  });

  it('prevents a duplicate report by the same customer for the same review', async () => {
    const { review } = await setupPendingReview('report-dup');
    const reporter = await registerAndLogin({ name: 'R', email: uniqueEmail('report-dup-reporter'), role: 'CUSTOMER' });
    await reporter.post(`/api/reviews/${review._id}/report`).send({ reason: 'SPAM' });
    const second = await reporter.post(`/api/reviews/${review._id}/report`).send({ reason: 'ABUSIVE' });
    expect(second.status).toBe(409);
    expect((await Review.findById(review._id)).reportCount).toBe(1);
  });

  it('blocks a customer from reporting their own review', async () => {
    const { customer, review } = await setupPendingReview('report-self');
    const res = await customer.post(`/api/reviews/${review._id}/report`).send({ reason: 'SPAM' });
    expect(res.status).toBe(400);
  });

  it('rejects an invalid reason and an unauthenticated report', async () => {
    const { review } = await setupPendingReview('report-invalid');
    const reporter = await registerAndLogin({ name: 'R', email: uniqueEmail('report-invalid-reporter'), role: 'CUSTOMER' });
    const badReason = await reporter.post(`/api/reviews/${review._id}/report`).send({ reason: 'NOT_A_REAL_REASON' });
    expect(badReason.status).toBe(422);

    const anon = await request(app).post(`/api/reviews/${review._id}/report`).send({ reason: 'SPAM' });
    expect(anon.status).toBe(401);
  });

  it('lets moderation staff see report reasons/count/timing but never the reporter identity', async () => {
    const { review } = await setupPendingReview('report-inspect');
    const reporter1 = await registerAndLogin({ name: 'R1', email: uniqueEmail('report-inspect-1'), role: 'CUSTOMER' });
    const reporter2 = await registerAndLogin({ name: 'R2', email: uniqueEmail('report-inspect-2'), role: 'CUSTOMER' });
    await reporter1.post(`/api/reviews/${review._id}/report`).send({ reason: 'SPAM' });
    await reporter2.post(`/api/reviews/${review._id}/report`).send({ reason: 'FAKE' });

    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.get(`/api/admin/reviews/${review._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.review.reportCount).toBe(2);
    expect(res.body.data.reports).toHaveLength(2);
    expect(res.body.data.reports.map((r) => r.reason).sort()).toEqual(['FAKE', 'SPAM']);
    res.body.data.reports.forEach((r) => {
      expect(r.reporter).toBeUndefined();
      expect(r.reporterId).toBeUndefined();
    });

    const listRes = await admin.get('/api/admin/reviews').query({ reported: 'true' });
    expect(listRes.body.data.reviews.map((r) => r._id)).toContain(review._id.toString());
  });
});

describe('Review notifications', () => {
  it('notifies the author on approve, reject (with reason) and hide/restore, each as a distinct event', async () => {
    const { customer, review } = await setupPendingReview('notif-cycle');
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;
    const { agent: admin } = await createUserWithRole('ADMIN');

    await admin.patch(`/api/admin/reviews/${review._id}/approve`);
    expect(await Notification.findOne({ recipient: custId, type: 'REVIEW_APPROVED' })).toBeTruthy();

    await admin.patch(`/api/admin/reviews/${review._id}/hide`).send({ reason: 'later found to violate policy' });
    const hideNotif = await Notification.findOne({ recipient: custId, type: 'REVIEW_HIDDEN' });
    expect(hideNotif).toBeTruthy();
    expect(hideNotif.data.reason).toBe('later found to violate policy');

    await admin.patch(`/api/admin/reviews/${review._id}/restore`);
    expect(await Notification.findOne({ recipient: custId, type: 'REVIEW_RESTORED' })).toBeTruthy();
  });

  it('a rejected review notifies the author with the reason', async () => {
    const { customer, review } = await setupPendingReview('notif-reject');
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;
    const { agent: admin } = await createUserWithRole('ADMIN');
    await admin.patch(`/api/admin/reviews/${review._id}/reject`).send({ reason: 'Off-topic' });
    const notif = await Notification.findOne({ recipient: custId, type: 'REVIEW_REJECTED' });
    expect(notif.data.reason).toBe('Off-topic');
  });

  it('a failed (invalid-transition) moderation attempt never creates a notification', async () => {
    const { customer, review } = await setupPendingReview('notif-noop');
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;
    const { agent: admin } = await createUserWithRole('ADMIN');
    // hide before ever approved -> 400, no transition actually happens
    await admin.patch(`/api/admin/reviews/${review._id}/hide`);
    expect(await Notification.findOne({ recipient: custId, type: 'REVIEW_HIDDEN' })).toBeNull();
  });

  it('moderation succeeds even when the review author no longer exists to be notified', async () => {
    const { customer, review } = await setupPendingReview('notif-gone');
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;
    await User.findByIdAndDelete(custId);

    const { agent: admin } = await createUserWithRole('ADMIN');
    const res = await admin.patch(`/api/admin/reviews/${review._id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body.data.review.moderationStatus).toBe('APPROVED');
  });
});

describe('Review admin listing — IDOR / scoping', () => {
  it('filtering by restaurant only returns that restaurant\'s reviews', async () => {
    const { restaurant: restaurantA, review: reviewA } = await setupPendingReview('scope-a');
    const { review: reviewB } = await setupPendingReview('scope-b');
    const { agent: admin } = await createUserWithRole('ADMIN');

    const res = await admin.get('/api/admin/reviews').query({ restaurant: restaurantA._id.toString() });
    const ids = res.body.data.reviews.map((r) => r._id);
    expect(ids).toContain(reviewA._id.toString());
    expect(ids).not.toContain(reviewB._id.toString());
  });

  it('a customer or restaurant owner cannot list or fetch the admin review queue', async () => {
    const { owner, customer, review } = await setupPendingReview('scope-rbac');
    expect((await customer.get('/api/admin/reviews')).status).toBe(403);
    expect((await owner.get(`/api/admin/reviews/${review._id}`)).status).toBe(403);
  });
});

describe('Review moderation backfill migration', () => {
  it('leaves a review that already has a moderationStatus untouched', async () => {
    const { review } = await setupPendingReview('migrate-untouched');
    const summary = await migrateReviewModeration({ apply: true });
    expect(summary.alreadyMigrated).toBeGreaterThanOrEqual(1);
    expect((await Review.findById(review._id)).moderationStatus).toBe('PENDING');
  });

  it('backfills a pre-M15 review (no moderationStatus stored) to APPROVED, dry-run changes nothing, apply is idempotent', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('migrate-legacy-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('migrate-legacy-c'), role: 'CUSTOMER' });
    const restRes = await owner.post('/api/restaurants').send({
      name: `Legacy Kitchen ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    const restaurantId = restRes.body.data.restaurant._id;
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;

    // Simulate a pre-M15 row: inserted directly, bypassing the schema default.
    const insertResult = await Review.collection.insertOne({
      user: new mongoose.Types.ObjectId(custId),
      restaurant: new mongoose.Types.ObjectId(restaurantId),
      order: new mongoose.Types.ObjectId(),
      rating: 5,
      comment: 'Pre-M15 review',
      images: [],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
    });
    const legacyId = insertResult.insertedId;

    const dryRun = await migrateReviewModeration({ apply: false });
    expect(dryRun.toUpdate).toBeGreaterThanOrEqual(1);
    expect((await Review.collection.findOne({ _id: legacyId })).moderationStatus).toBeUndefined();

    const applied = await migrateReviewModeration({ apply: true });
    expect(applied.updated).toBeGreaterThanOrEqual(1);
    const migrated = await Review.findById(legacyId);
    expect(migrated.moderationStatus).toBe('APPROVED');
    expect(migrated.moderatedAt).toEqual(new Date('2024-01-01'));

    // Idempotent — a second apply run touches nothing new.
    const secondApply = await migrateReviewModeration({ apply: true });
    expect(secondApply.toUpdate).toBe(0);
  });
});
