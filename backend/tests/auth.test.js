require('./setup');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app, registerAndLogin, uniqueEmail } = require('./helpers');
const User = require('../src/models/User');

describe('Authentication', () => {
  it('registers a new customer and never returns the password hash', async () => {
    const email = uniqueEmail('reg');
    const res = await request(app).post('/api/auth/register').send({ name: 'New User', email, password: 'password123' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe(email);
    expect('password' in res.body.data.user).toBe(false);
  });

  it('rejects a duplicate email with 409', async () => {
    const email = uniqueEmail('dup');
    await request(app).post('/api/auth/register').send({ name: 'A', email, password: 'password123' });
    const res = await request(app).post('/api/auth/register').send({ name: 'B', email, password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('rejects public self-registration with role=ADMIN', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'X', email: uniqueEmail('adm'), password: 'password123', role: 'ADMIN' });
    expect(res.status).toBe(422);
  });

  it('rejects login with the wrong password using a generic message', async () => {
    const email = uniqueEmail('wrongpw');
    await request(app).post('/api/auth/register').send({ name: 'A', email, password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'nope' });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/invalid email or password/i);
  });

  it('logs in and receives an auth cookie', async () => {
    const email = uniqueEmail('login');
    await request(app).post('/api/auth/register').send({ name: 'A', email, password: 'password123' });
    const res = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('rejects /me with no credentials', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('accepts /me with the session cookie', async () => {
    const email = uniqueEmail('me');
    const agent = await registerAndLogin({ name: 'Me User', email });
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(email);
  });

  it('accepts /me with an Authorization: Bearer token instead of the cookie', async () => {
    const email = uniqueEmail('bearer');
    await request(app).post('/api/auth/register').send({ name: 'A', email, password: 'password123' });
    const loginRes = await request(app).post('/api/auth/login').send({ email, password: 'password123' });
    const token = loginRes.body.data.token;
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('rejects a deactivated account on its next request, even with a still-valid token', async () => {
    const email = uniqueEmail('deactivated');
    const agent = await registerAndLogin({ name: 'Deactivated', email });
    const user = await User.findOne({ email });
    user.isActive = false;
    await user.save();

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects an expired JWT with "Session expired"', async () => {
    const email = uniqueEmail('expired');
    await request(app).post('/api/auth/register').send({ name: 'A', email, password: 'password123' });
    const user = await User.findOne({ email });

    const expiredToken = jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, { expiresIn: '1ms' });
    await new Promise((resolve) => setTimeout(resolve, 20)); // let it actually expire

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/session expired/i);
  });

  it('logs out and clears the cookie', async () => {
    const agent = await registerAndLogin({ name: 'Logout', email: uniqueEmail('logout') });
    const res = await agent.post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});

describe('Authorization (RBAC)', () => {
  it('blocks a CUSTOMER from creating a restaurant (owner-only action)', async () => {
    const agent = await registerAndLogin({ name: 'Cust', email: uniqueEmail('rbac-cust'), role: 'CUSTOMER' });
    const res = await agent.post('/api/restaurants').send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('blocks an unauthenticated request from creating a restaurant', async () => {
    const res = await request(app).post('/api/restaurants').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('allows a RESTAURANT_OWNER to pass the role check (still needs valid body)', async () => {
    const agent = await registerAndLogin({ name: 'Owner', email: uniqueEmail('rbac-owner'), role: 'RESTAURANT_OWNER' });
    const res = await agent.post('/api/restaurants').send({}); // empty body -> validation error, not a role error
    expect(res.status).toBe(422);
  });
});
