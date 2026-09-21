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
  await Restaurant.findByIdAndUpdate(restaurant._id, { isApproved: true });
  const catRes = await owner.post('/api/categories').send({ restaurant: restaurant._id, name: 'Mains' });
  const foodRes = await owner.post('/api/foods').send({
    restaurant: restaurant._id, category: catRes.body.data.category._id, name: 'Test Item', price: opts.price ?? 100, isVeg: true,
  });
  return { restaurant, food: foodRes.body.data.food };
}

module.exports = { app, registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable };
