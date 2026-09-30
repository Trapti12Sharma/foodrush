require('./setup');
const request = require('supertest');
const app = require('../src/app');
const { registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const Restaurant = require('../src/models/Restaurant');
const Order = require('../src/models/Order');
const Review = require('../src/models/Review');
const Notification = require('../src/models/Notification');
const DeliveryEarning = require('../src/models/DeliveryEarning');

// ---------------------------------------------------------------------------
// M24 — THE WHOLE JOURNEY, ONCE, IN ORDER.
//
// The other 760 tests each prove one milestone in isolation. What none of them
// prove is that the milestones CONNECT: that a restaurant onboarded through the
// M14 KYC flow can be discovered by the M3 search, ordered from through the M5
// cart, dispatched by M7 to a rider onboarded through M6, completed with the M9
// OTP, paid out through M10, reviewed through M15, replied to through M21, and
// then counted correctly by M16 analytics.
//
// Every step below goes through the real HTTP API as the real actor, and every
// state transition is asserted from the SERVER's response or the database — the
// point is that no step is takeable by a client simply asserting it happened.
//
// Distances are real: the restaurant and rider are placed ~1.5 km apart in Pune
// so the geospatial rider search has something true to find.
// ---------------------------------------------------------------------------
const PUNE = [73.8567, 18.5204]; // [lng, lat]
const NEAR_PUNE = [73.86, 18.5215]; // ~1.5 km from the restaurant

const DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';

function riderPayload() {
  return {
    fullName: 'Journey Rider',
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
  };
}

describe('End-to-end journey: onboarding -> order -> delivery -> review -> analytics', () => {
  // One long test on purpose. Splitting it into `it`s would need the state
  // rebuilt for each, and rebuilt state is exactly what an integration test is
  // supposed to stop trusting — the value here is that step 14 runs against
  // whatever step 1 actually produced.
  it('carries one order through every milestone, with the backend authoritative at each step', async () => {
    const admin = (await createUserWithRole('ADMIN')).agent;

    // -- 1. Restaurant onboarding + KYC (M14) ------------------------------
    const owner = await registerAndLogin({ name: 'Journey Owner', email: uniqueEmail('e2e-owner'), role: 'RESTAURANT_OWNER' });
    const createRes = await owner.post('/api/restaurants').send({
      name: `Journey Kitchen ${Date.now()}`,
      cuisine: ['Italian'], address: { addressLine: '1 Food St' }, city: 'Pune',
      deliveryTime: 25, deliveryFee: 10, minimumOrder: 0,
    });
    expect(createRes.status).toBe(201);
    const restaurantId = createRes.body.data.restaurant._id;

    // A brand-new restaurant is NOT live: it has not submitted KYC and no admin
    // has approved it.
    expect(createRes.body.data.restaurant.isApproved).toBe(false);
    expect(createRes.body.data.restaurant.kycStatus).toBe('NOT_SUBMITTED');

    // Approving before KYC is submitted is refused — the gate is real.
    expect((await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`)).status).toBe(400);

    await owner.post(`/api/restaurants/${restaurantId}/kyc/submit`).send({
      fssaiLicenseNumber: '12345678901234', fssaiCertificateUrl: DOC_URL,
      panNumber: 'ABCDE1234F', panCardUrl: DOC_URL, ownerIdentityProofUrl: DOC_URL,
    }).expect(200);

    const approveRes = await admin.patch(`/api/admin/restaurants/${restaurantId}/approve`);
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.restaurant.isApproved).toBe(true);
    expect(approveRes.body.data.restaurant.kycStatus).toBe('VERIFIED');

    // Give it a real location so the geo search below is meaningful.
    await Restaurant.findByIdAndUpdate(restaurantId, { location: { type: 'Point', coordinates: PUNE } });

    // -- 2. Menu (M4) ------------------------------------------------------
    const catRes = await owner.post('/api/categories').send({ restaurant: restaurantId, name: 'Pizza' });
    const foodRes = await owner.post('/api/foods').send({
      restaurant: restaurantId, category: catRes.body.data.category._id,
      name: 'Journey Margherita', price: 200, isVeg: true,
    });
    expect(foodRes.status).toBe(201);
    const foodId = foodRes.body.data.food._id;

    // -- 3. Discovery: the restaurant is now publicly findable (M3) ---------
    const nearby = await request(app).get('/api/restaurants/nearby').query({ lat: PUNE[1], lng: PUNE[0] });
    expect(nearby.status).toBe(200);
    expect(nearby.body.data.restaurants.map((r) => r._id)).toContain(restaurantId);

    // -- 4. Cart + coupon (M5) --------------------------------------------
    const customer = await registerAndLogin({ name: 'Journey Customer', email: uniqueEmail('e2e-cust'), role: 'CUSTOMER' });
    const code = `E2E${Date.now().toString().slice(-6)}`;
    await admin.post('/api/coupons').send({
      code, description: 'Journey coupon', discountType: 'FLAT', discountValue: 25,
      minimumOrder: 0, expiryDate: new Date(Date.now() + 86400000), usageLimit: 5,
    }).expect(201);

    const addrRes = await customer.post('/api/addresses').send({
      addressLine: '9 Customer Rd', city: 'Pune', pincode: '411001',
      latitude: NEAR_PUNE[1], longitude: NEAR_PUNE[0],
    });
    await customer.post('/api/cart/items').send({ foodId, quantity: 2 }).expect(201);
    const couponRes = await customer.post('/api/cart/coupon').send({ code });
    expect(couponRes.status).toBe(200);

    // The server priced this, not the client: 2 x 200 = 400, -25 coupon,
    // +10 delivery, +5% tax on the discounted subtotal.
    const cart = couponRes.body.data.cart;
    expect(cart.subtotal).toBeCloseTo(400, 2);
    expect(cart.discount).toBeCloseTo(25, 2);

    // -- 5. Order placement (M5) ------------------------------------------
    const orderRes = await customer.post('/api/orders').send({
      addressId: addrRes.body.data.address._id, paymentMethod: 'COD',
    });
    expect(orderRes.status).toBe(201);
    const order = orderRes.body.data.order;
    const orderId = order._id;
    expect(order.orderStatus).toBe('PLACED');
    expect(order.orderNumber).toMatch(/^FR\d+/);
    // Totals are the server's, carried from the cart it priced.
    expect(order.totalAmount).toBeCloseTo(cart.total, 2);

    // Both sides are told (M12).
    const ownerId = (await owner.get('/api/auth/me')).body.data.user._id;
    const customerId = (await customer.get('/api/auth/me')).body.data.user._id;
    expect(await Notification.findOne({ recipient: customerId, type: 'ORDER_PLACED' })).toBeTruthy();
    expect(await Notification.findOne({ recipient: ownerId, type: 'ORDER_PLACED' })).toBeTruthy();

    // -- 6. A customer cannot move their own order forward -----------------
    // The single most important authority check in the whole flow.
    expect((await customer.patch(`/api/orders/${orderId}/status`).send({ status: 'DELIVERED' })).status).toBe(403);
    expect((await Order.findById(orderId)).orderStatus).toBe('PLACED');

    // -- 7. Restaurant works the order (M5) --------------------------------
    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'CONFIRMED' }).expect(200);
    // Illegal jumps are refused by the transition table, not just by the UI.
    expect((await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'DELIVERED' })).status).toBe(400);
    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'PREPARING' }).expect(200);

    // -- 8. Rider onboarding (M6) ------------------------------------------
    const rider = await registerAndLogin({ name: 'Journey Rider', email: uniqueEmail('e2e-rider'), role: 'DELIVERY_PARTNER' });
    const riderRes = await rider.post('/api/delivery-partners').send(riderPayload());
    expect(riderRes.status).toBe(201);
    const riderId = riderRes.body.data.deliveryPartner._id;

    // An unverified rider cannot go online — KYC gates availability.
    expect((await rider.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' })).status).toBe(400);

    await admin.patch(`/api/admin/delivery-partners/${riderId}/approve-kyc`).expect(200);
    await rider.patch('/api/delivery-partners/me/location').send({ latitude: NEAR_PUNE[1], longitude: NEAR_PUNE[0] }).expect(200);
    await rider.patch('/api/delivery-partners/me/availability').send({ availability: 'ONLINE' }).expect(200);

    // -- 9. Dispatch fires on READY_FOR_PICKUP (M7) ------------------------
    await owner.patch(`/api/orders/${orderId}/status`).send({ status: 'READY_FOR_PICKUP' }).expect(200);

    const offers = await rider.get('/api/delivery-assignments/me/offers');
    expect(offers.status).toBe(200);
    // The geospatial search actually found this rider for this order.
    const offer = offers.body.data.offers.find((a) => String(a.order._id || a.order) === String(orderId));
    expect(offer).toBeTruthy();
    expect(offer.status).toBe('OFFERED');

    // A different rider cannot take someone else's offer.
    const otherRider = await registerAndLogin({ name: 'Other', email: uniqueEmail('e2e-rider2'), role: 'DELIVERY_PARTNER' });
    await otherRider.post('/api/delivery-partners').send(riderPayload());
    expect((await otherRider.patch(`/api/delivery-assignments/${offer._id}/accept`)).status).toBe(403);

    // -- 10. Acceptance moves the ORDER, not just the assignment -----------
    await rider.patch(`/api/delivery-assignments/${offer._id}/accept`).expect(200);
    expect((await Order.findById(orderId)).orderStatus).toBe('OUT_FOR_DELIVERY');

    // -- 11. OTP completion (M9) -------------------------------------------
    const otpRes = await customer.get(`/api/orders/${orderId}/delivery-otp`);
    expect(otpRes.status).toBe(200);
    const otp = otpRes.body.data.otp;
    expect(otp).toMatch(/^\d{6}$/);

    // The rider cannot simply declare the delivery done.
    const wrongOtp = await rider.post(`/api/delivery-assignments/${offer._id}/verify-otp`).send({ otp: '000000' });
    expect(wrongOtp.status).toBe(400);
    expect((await Order.findById(orderId)).orderStatus).toBe('OUT_FOR_DELIVERY');

    await rider.post(`/api/delivery-assignments/${offer._id}/verify-otp`).send({ otp }).expect(200);
    expect((await Order.findById(orderId)).orderStatus).toBe('DELIVERED');

    // -- 12. Earnings are ledgered (M10) -----------------------------------
    const earning = await DeliveryEarning.findOne({ order: orderId });
    expect(earning).toBeTruthy();
    expect(earning.netAmount).toBeGreaterThan(0);
    expect(earning.status).toBe('PENDING'); // earned, not yet settled

    // -- 13. Review -> moderation -> rating (M15) --------------------------
    const reviewRes = await customer.post('/api/reviews').send({
      restaurant: restaurantId, order: orderId, rating: 5, comment: 'Arrived hot, great pizza',
    });
    expect(reviewRes.status).toBe(201);
    const reviewId = reviewRes.body.data.review._id;
    expect(reviewRes.body.data.review.moderationStatus).toBe('PENDING');

    // A pending review is invisible to the public and does not move the rating.
    let publicReviews = await request(app).get(`/api/restaurants/${restaurantId}/reviews`);
    expect(publicReviews.body.data.reviews).toHaveLength(0);
    expect((await Restaurant.findById(restaurantId)).rating).toBe(0);

    await admin.patch(`/api/admin/reviews/${reviewId}/approve`).expect(200);
    expect((await Restaurant.findById(restaurantId)).rating).toBe(5);
    expect((await Restaurant.findById(restaurantId)).totalReviews).toBe(1);

    // -- 14. Owner replies, customer sees it (M21) -------------------------
    await owner.put(`/api/reviews/${reviewId}/reply`).send({ text: 'Thank you — see you again soon!' }).expect(200);

    publicReviews = await request(app).get(`/api/restaurants/${restaurantId}/reviews`);
    expect(publicReviews.body.data.reviews).toHaveLength(1);
    expect(publicReviews.body.data.reviews[0].reply.text).toBe('Thank you — see you again soon!');
    // The owner's user id is not handed to the public with it.
    expect(publicReviews.body.data.reviews[0].reply.repliedBy).toBeUndefined();

    // -- 15. Analytics counts exactly this order (M16) ---------------------
    const ownerAnalytics = await owner.get(`/api/restaurants/${restaurantId}/analytics`).query({ preset: 'today' });
    expect(ownerAnalytics.status).toBe(200);
    expect(ownerAnalytics.body.data.summary.fulfilledOrders).toBe(1);
    expect(ownerAnalytics.body.data.summary.grossSales).toBeCloseTo(order.totalAmount, 2);
    // The discount the coupon gave is reported, and was already taken off the total.
    expect(ownerAnalytics.body.data.summary.discounts).toBeCloseTo(25, 2);
    expect(ownerAnalytics.body.data.summary.reviewsInRange).toBe(1);

    // The item sold shows up in the menu breakdown at its line total (2 x 200),
    // excluding delivery and tax.
    const topItem = ownerAnalytics.body.data.topItems.find((i) => String(i.foodId) === String(foodId));
    expect(topItem.quantity).toBe(2);
    expect(topItem.sales).toBeCloseTo(400, 2);

    // -- 16. A different owner sees none of it (IDOR) ----------------------
    const otherOwner = await registerAndLogin({ name: 'Nosy', email: uniqueEmail('e2e-owner2'), role: 'RESTAURANT_OWNER' });
    expect((await otherOwner.get(`/api/restaurants/${restaurantId}/analytics`)).status).toBe(403);
    expect((await otherOwner.get(`/api/restaurants/${restaurantId}/dashboard`)).status).toBe(403);
  }, 120000); // the whole lifecycle in one test needs more than the 20 s default
});

describe('End-to-end: support and refund branches', () => {
  it('lets a customer raise a ticket about their order and staff resolve it', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('e2e-sup-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('e2e-sup-c'), role: 'CUSTOMER' });
    const res = await owner.post('/api/restaurants').send({
      name: `Support Kitchen ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' },
      city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
    });
    const restaurantId = res.body.data.restaurant._id;
    await Restaurant.findByIdAndUpdate(restaurantId, { isApproved: true });
    const catRes = await owner.post('/api/categories').send({ restaurant: restaurantId, name: 'Mains' });
    const foodRes = await owner.post('/api/foods').send({
      restaurant: restaurantId, category: catRes.body.data.category._id, name: 'Item', price: 100, isVeg: true,
    });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
    const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    const orderId = orderRes.body.data.order._id;

    const ticketRes = await customer.post('/api/support/tickets').send({
      category: 'ORDER', subject: 'Order is late', description: 'It has been an hour.', orderId,
    });
    expect(ticketRes.status).toBe(201);
    const ticketId = ticketRes.body.data.ticket._id;

    // A different customer cannot read it.
    const stranger = await registerAndLogin({ name: 'S', email: uniqueEmail('e2e-sup-x'), role: 'CUSTOMER' });
    expect((await stranger.get(`/api/support/tickets/${ticketId}`)).status).toBe(404);

    const { agent: agentStaff } = await createUserWithRole('SUPPORT_AGENT');
    await agentStaff.post(`/api/admin/support/tickets/${ticketId}/messages`).send({ message: 'Looking into it now.' }).expect(201);
    await agentStaff.patch(`/api/admin/support/tickets/${ticketId}/status`).send({ status: 'IN_PROGRESS' }).expect(200);
    const resolved = await agentStaff.patch(`/api/admin/support/tickets/${ticketId}/resolve`).send({ resolution: 'Refund issued' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.ticket.status).toBe('RESOLVED');

    // The customer is told, and can read the reply on their own ticket.
    const customerId = (await customer.get('/api/auth/me')).body.data.user._id;
    expect(await Notification.findOne({ recipient: customerId, type: 'SUPPORT_TICKET_RESOLVED' })).toBeTruthy();
    const mine = await customer.get(`/api/support/tickets/${ticketId}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.ticket.messages.some((m) => m.message === 'Looking into it now.')).toBe(true);
  }, 60000);

  it('cancels a COD order and leaves it out of sales, with no refund invented', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('e2e-cancel-o'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('e2e-cancel-c'), role: 'CUSTOMER' });
    const res = await owner.post('/api/restaurants').send({
      name: `Cancel Kitchen ${Date.now()}`, cuisine: ['Test'], address: { addressLine: '1 St' },
      city: 'Pune', deliveryTime: 20, deliveryFee: 10, minimumOrder: 0,
    });
    const restaurantId = res.body.data.restaurant._id;
    await Restaurant.findByIdAndUpdate(restaurantId, { isApproved: true });
    const catRes = await owner.post('/api/categories').send({ restaurant: restaurantId, name: 'Mains' });
    const foodRes = await owner.post('/api/foods').send({
      restaurant: restaurantId, category: catRes.body.data.category._id, name: 'Item', price: 100, isVeg: true,
    });
    const addrRes = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: foodRes.body.data.food._id, quantity: 1 });
    const orderRes = await customer.post('/api/orders').send({ addressId: addrRes.body.data.address._id, paymentMethod: 'COD' });
    const orderId = orderRes.body.data.order._id;

    await customer.post(`/api/orders/${orderId}/cancel`).send({ reason: 'Changed my mind' }).expect(200);
    expect((await Order.findById(orderId)).orderStatus).toBe('CANCELLED');

    // A COD order was never paid, so nothing is refunded — a cancelled order is
    // not assumed to be a refunded one.
    const Refund = require('../src/models/Refund');
    expect(await Refund.findOne({ order: orderId })).toBeNull();

    // And it contributes nothing to sales.
    const analytics = await owner.get(`/api/restaurants/${restaurantId}/analytics`).query({ preset: 'today' });
    expect(analytics.body.data.summary.fulfilledOrders).toBe(0);
    expect(analytics.body.data.summary.grossSales).toBe(0);

    // The order cannot be reviewed, because it was never delivered.
    const reviewAttempt = await customer.post('/api/reviews').send({ restaurant: restaurantId, order: orderId, rating: 1 });
    expect(reviewAttempt.status).toBe(400);
  }, 60000);
});
