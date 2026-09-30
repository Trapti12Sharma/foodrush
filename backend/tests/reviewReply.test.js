require('./setup');
const request = require('supertest');
const app = require('../src/app');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Review = require('../src/models/Review');
const Notification = require('../src/models/Notification');
const AuditLog = require('../src/models/AuditLog');

// An APPROVED review on `owner`'s restaurant, written by `customer` — the state
// every reply case starts from. Built through the real APIs (order placed,
// driven to DELIVERED, reviewed, then approved by an admin) so the review under
// test is one the application itself would have produced.
async function setupApprovedReview(label) {
  const owner = await registerAndLogin({ name: 'Owner', email: uniqueEmail(`rr-${label}-o`), role: 'RESTAURANT_OWNER' });
  const customer = await registerAndLogin({ name: 'Cust', email: uniqueEmail(`rr-${label}-c`), role: 'CUSTOMER' });

  const res = await owner.post('/api/restaurants').send({
    name: `Reply Kitchen ${label} ${Date.now()}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
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

  const reviewRes = await customer.post('/api/reviews').send({
    restaurant: restaurant._id, order: order._id, rating: 4, comment: 'Decent but late',
  });
  const review = reviewRes.body.data.review;

  const { agent: admin } = await createUserWithRole('ADMIN');
  await admin.patch(`/api/admin/reviews/${review._id}/approve`).expect(200);

  return { owner, customer, restaurant, review, admin };
}

describe('Review replies — publishing', () => {
  it("lets the restaurant's owner publish a reply, which appears to customers", async () => {
    const { owner, customer, restaurant, review } = await setupApprovedReview('publish');

    const res = await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Sorry about the wait — we were short-staffed.' });
    expect(res.status).toBe(200);
    expect(res.body.data.review.reply.text).toBe('Sorry about the wait — we were short-staffed.');

    // The whole point: a customer browsing the restaurant sees it.
    const publicView = await request(app).get(`/api/restaurants/${restaurant._id}/reviews`);
    expect(publicView.body.data.reviews[0].reply.text).toBe('Sorry about the wait — we were short-staffed.');
    expect(publicView.body.data.reviews[0].reply.repliedAt).toBeTruthy();
  });

  it('never exposes which user account wrote the reply', async () => {
    const { owner, restaurant, review } = await setupApprovedReview('privacy');
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Thanks for the feedback.' });

    const publicView = await request(app).get(`/api/restaurants/${restaurant._id}/reviews`);
    // The reply speaks for the restaurant, not for a named individual.
    expect(publicView.body.data.reviews[0].reply.repliedBy).toBeUndefined();
    // ...but it IS recorded in the database for the audit trail.
    expect((await Review.findById(review._id)).reply.repliedBy).toBeTruthy();
  });

  it('replaces the existing reply rather than accumulating replies', async () => {
    const { owner, review } = await setupApprovedReview('replace');
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'First attempt with a typpo' });
    const second = await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Fixed the typo' });

    expect(second.status).toBe(200);
    expect(second.body.data.review.reply.text).toBe('Fixed the typo');
    // A review holds at most one reply — the model has a single subdocument,
    // not an array, so a double-submit cannot produce two.
    const stored = await Review.findById(review._id);
    expect(stored.reply.text).toBe('Fixed the typo');
  });

  it('rejects an empty or whitespace-only reply, and one over the length cap', async () => {
    const { owner, review } = await setupApprovedReview('validation');

    expect((await owner.put(`/api/reviews/${review._id}/reply`).send({ text: '' })).status).toBe(422);
    expect((await owner.put(`/api/reviews/${review._id}/reply`).send({ text: '    ' })).status).toBe(422);
    expect((await owner.put(`/api/reviews/${review._id}/reply`).send({})).status).toBe(422);
    expect((await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'x'.repeat(1001) })).status).toBe(422);

    expect((await Review.findById(review._id)).reply).toBeNull();
  });

  it('records an audit entry naming the restaurant', async () => {
    const { owner, restaurant, review } = await setupApprovedReview('audit');
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Noted, thank you.' });

    const log = await AuditLog.findOne({ action: 'review.reply', entityId: review._id });
    expect(log).toBeTruthy();
    expect(log.metadata.restaurant).toBe(restaurant._id.toString());
  });
});

describe('Review replies — authorization', () => {
  it("blocks a different restaurant's owner from replying", async () => {
    const { review } = await setupApprovedReview('cross-owner');
    const intruder = await registerAndLogin({ name: 'Other', email: uniqueEmail('rr-intruder'), role: 'RESTAURANT_OWNER' });

    const res = await intruder.put(`/api/reviews/${review._id}/reply`).send({ text: 'Actually we are great' });
    expect(res.status).toBe(403);
    expect((await Review.findById(review._id)).reply).toBeNull();
  });

  it('blocks the reviewing customer from replying to their own review as the restaurant', async () => {
    const { customer, review } = await setupApprovedReview('customer-reply');
    const res = await customer.put(`/api/reviews/${review._id}/reply`).send({ text: 'The restaurant agrees with me' });
    expect(res.status).toBe(403);
  });

  it('blocks an unauthenticated caller', async () => {
    const { review } = await setupApprovedReview('anon');
    const res = await request(app).put(`/api/reviews/${review._id}/reply`).send({ text: 'hello' });
    expect(res.status).toBe(401);
  });

  it('does NOT let platform staff publish a reply in a restaurant\'s name', async () => {
    const { review } = await setupApprovedReview('staff-write');
    // RESTAURANT_MANAGER holds restaurants:manage and reviews:moderate — it can
    // edit the restaurant and moderate the review, but must not speak AS the
    // restaurant. Administration is not speech.
    const { agent: manager } = await createUserWithRole('RESTAURANT_MANAGER');
    const res = await manager.put(`/api/reviews/${review._id}/reply`).send({ text: 'Posted by the platform' });

    expect(res.status).toBe(403);
    expect((await Review.findById(review._id)).reply).toBeNull();
  });

  it('returns 404 for a review that does not exist', async () => {
    const { owner } = await setupApprovedReview('missing');
    const res = await owner.put('/api/reviews/507f1f77bcf86cd799439011/reply').send({ text: 'hi' });
    expect(res.status).toBe(404);
  });
});

describe('Review replies — moderation state', () => {
  it('refuses to reply to a review that is still PENDING', async () => {
    // Built without the approve step: the review is not public, so a reply to it
    // would be a reply nobody can see.
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('rr-pending-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('rr-pending-c'), role: 'CUSTOMER' });
    const res = await owner.post('/api/restaurants').send({
      name: `Pending Kitchen ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
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
    for (const status of ['CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      await owner.patch(`/api/orders/${orderRes.body.data.order._id}/status`).send({ status });
    }
    const reviewRes = await customer.post('/api/reviews').send({
      restaurant: restaurant._id, order: orderRes.body.data.order._id, rating: 2,
    });

    const reply = await owner.put(`/api/reviews/${reviewRes.body.data.review._id}/reply`).send({ text: 'Let me explain' });
    expect(reply.status).toBe(400);
  });

  it('refuses to reply to a HIDDEN review', async () => {
    const { owner, review, admin } = await setupApprovedReview('hidden');
    await admin.patch(`/api/admin/reviews/${review._id}/hide`).send({ reason: 'policy' }).expect(200);

    const res = await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Still want to answer' });
    expect(res.status).toBe(400);
  });

  it('keeps an existing reply attached when the review is later hidden and restored', async () => {
    const { owner, review, admin } = await setupApprovedReview('hide-restore');
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Our side of it' }).expect(200);

    await admin.patch(`/api/admin/reviews/${review._id}/hide`).send({ reason: 'checking' }).expect(200);
    await admin.patch(`/api/admin/reviews/${review._id}/restore`).expect(200);

    // Moderating the review does not destroy the restaurant's answer to it.
    expect((await Review.findById(review._id)).reply.text).toBe('Our side of it');
  });
});

describe('Review replies — removal', () => {
  it('lets the owner retract their own reply', async () => {
    const { owner, review } = await setupApprovedReview('retract');
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Said too much' }).expect(200);

    const res = await owner.delete(`/api/reviews/${review._id}/reply`);
    expect(res.status).toBe(200);
    expect((await Review.findById(review._id)).reply).toBeNull();
  });

  it('lets a moderator remove an abusive reply the owner will not retract', async () => {
    const { owner, review, admin } = await setupApprovedReview('moderator-remove');
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Something abusive' }).expect(200);

    // This is the reason removal is not owner-only: replies are published
    // without a moderation queue, so the remedy has to work without the author.
    const res = await admin.delete(`/api/reviews/${review._id}/reply`);
    expect(res.status).toBe(200);
    expect((await Review.findById(review._id)).reply).toBeNull();

    const log = await AuditLog.findOne({ action: 'review.reply_delete', entityId: review._id });
    expect(log.metadata.byModerator).toBe(true);
  });

  it("blocks another restaurant's owner and the customer from removing a reply", async () => {
    const { owner, customer, review } = await setupApprovedReview('remove-rbac');
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Our answer' }).expect(200);
    const intruder = await registerAndLogin({ name: 'X', email: uniqueEmail('rr-remove-x'), role: 'RESTAURANT_OWNER' });

    expect((await intruder.delete(`/api/reviews/${review._id}/reply`)).status).toBe(403);
    expect((await customer.delete(`/api/reviews/${review._id}/reply`)).status).toBe(403);
    expect((await Review.findById(review._id)).reply.text).toBe('Our answer');
  });

  it('returns 404 when there is no reply to remove', async () => {
    const { owner, review } = await setupApprovedReview('remove-none');
    expect((await owner.delete(`/api/reviews/${review._id}/reply`)).status).toBe(404);
  });
});

describe('Review replies — notifications', () => {
  it('notifies the review author the first time the restaurant replies', async () => {
    const { owner, customer, review } = await setupApprovedReview('notify');
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;

    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Thanks for telling us' }).expect(200);

    const notif = await Notification.findOne({ recipient: custId, type: 'REVIEW_REPLIED' });
    expect(notif).toBeTruthy();
    expect(notif.data.reviewId.toString()).toBe(review._id.toString());
  });

  it('does not notify again when the reply is merely edited', async () => {
    const { owner, customer, review } = await setupApprovedReview('notify-once');
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;

    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'First' }).expect(200);
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'First, but spelled correctly' }).expect(200);
    await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Third pass' }).expect(200);

    // Re-notifying on every edit would turn the notification bell into a feed of
    // someone else's typo corrections.
    expect(await Notification.countDocuments({ recipient: custId, type: 'REVIEW_REPLIED' })).toBe(1);
  });

  it('still publishes the reply when the review author no longer exists', async () => {
    const { owner, customer, review } = await setupApprovedReview('notify-gone');
    const custId = (await customer.get('/api/auth/me')).body.data.user._id;
    const User = require('../src/models/User');
    await User.findByIdAndDelete(custId);

    const res = await owner.put(`/api/reviews/${review._id}/reply`).send({ text: 'Answering anyway' });
    expect(res.status).toBe(200);
    expect((await Review.findById(review._id)).reply.text).toBe('Answering anyway');
  });
});
