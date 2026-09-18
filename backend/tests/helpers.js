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

module.exports = { app, registerAndLogin, uniqueEmail };
