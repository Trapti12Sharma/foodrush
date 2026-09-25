const request = require('supertest');
const app = require('../src/app');

async function registerAndLogin({ name, email, password = 'password123', role }) {
  await request(app).post('/api/auth/register').send({ name, email, password, role });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(res.body)}`);
  return agent;
}

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

// Staff/other non-self-registerable roles are provisioned directly in the database,
// exactly as the seed script and real deployments do, then logged in normally.
async function createUserWithRole(role, prefix = role.toLowerCase()) {
  const User = require('../src/models/User');
  const email = uniqueEmail(prefix);
  const user = await User.create({ name: `Test ${role}`, email, password: 'password123', role });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password: 'password123' });
  if (res.status !== 200) throw new Error(`login failed for ${role}: ${JSON.stringify(res.body)}`);
  return { agent, user, email };
}

// An approved, open restaurant owned by `owner`, with one category and one food.
async function setupOrderable(owner, opts = {}) {
  const Restaurant = require('../src/models/Restaurant');
  const res = await owner.post('/api/restaurants').send({
    name: `Test Kitchen ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune',
    deliveryTime: 20, deliveryFee: opts.deliveryFee ?? 10, minimumOrder: opts.minimumOrder ?? 0,
  });
  const restaurant = res.body.data.restaurant;
  // A direct DB bypass of the real admin-approval flow (kept intentionally simple
  // for the hundreds of tests that just need "an approved restaurant" and don't
  // care about M14's KYC gate) — kycStatus is set to match for data consistency,
  // not because anything here actually exercises the KYC review itself.
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true, kycStatus: 'VERIFIED' });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Test Item', price: opts.price ?? 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

// Shared demo asset URL for every KYC-document-shaped test fixture across the
// suite (delivery partner AND restaurant) — a real, decodable Cloudinary-shaped
// URL, never a fake/placeholder value pretending to be verified data.
const KYC_DOC_URL = 'https://res.cloudinary.com/demo/image/upload/v1/foodrush/kyc/000000000000000000000000/abc123.jpg';

// M14 — submits valid, complete business-verification documents for a restaurant
// the given (already-authenticated) owner agent owns, moving its kycStatus to
// SUBMITTED so an admin's approve endpoint can then succeed on it. Used by every
// test that needs to exercise the real admin-approval flow via the API (as
// opposed to setupOrderable's direct DB bypass, which most tests use instead).
// Deliberately NOT `async` — an async function would flatten the returned
// supertest Test object into a plain Promise, losing its chainable .expect(),
// which every call site relies on (e.g. `submitRestaurantKyc(...).expect(200)`).
function submitRestaurantKyc(ownerAgent, restaurantId) {
  return ownerAgent.post(`/api/restaurants/${restaurantId}/kyc/submit`).send({
    fssaiLicenseNumber: '12345678901234',
    fssaiCertificateUrl: KYC_DOC_URL,
    panNumber: 'ABCDE1234F',
    panCardUrl: KYC_DOC_URL,
    ownerIdentityProofUrl: KYC_DOC_URL,
  });
}

module.exports = { app, registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable, submitRestaurantKyc, KYC_DOC_URL };
