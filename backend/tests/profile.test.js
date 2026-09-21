require('./setup');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { app, registerAndLogin, uniqueEmail } = require('./helpers');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const emailService = require('../src/services/email.service');
const { isSafeAvatar } = require('../src/validators/profile.validator');

let sendSpy;
beforeEach(() => {
  sendSpy = jest.spyOn(emailService, 'sendMail').mockResolvedValue(undefined);
});
afterEach(() => sendSpy.mockRestore());

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

describe('PUT /api/auth/me (profile)', () => {
  it('updates name, phone and avatar, and returns the user without secrets', async () => {
    const agent = await registerAndLogin({ name: 'Old', email: uniqueEmail('pf'), role: 'CUSTOMER' });
    const res = await agent.put('/api/auth/me').send({ name: 'New Name', phone: '+91 98765 43210', avatar: '/uploads/abc-123.png' });
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ name: 'New Name', phone: '+91 98765 43210', avatar: '/uploads/abc-123.png' });
    expect('password' in res.body.data.user).toBe(false);
    expect('passwordResetTokenHash' in res.body.data.user).toBe(false);
  });

  it('requires authentication', async () => {
    expect((await request(app).put('/api/auth/me').send({ name: 'x' })).status).toBe(401);
  });

  it('cannot be used to escalate privileges or touch protected fields', async () => {
    const email = uniqueEmail('pf-esc');
    const agent = await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
    await agent.put('/api/auth/me').send({ name: 'Still Me', role: 'SUPER_ADMIN', isActive: false, permissions: ['audit:read'], passwordChangedAt: null });
    const user = await User.findOne({ email });
    expect(user.name).toBe('Still Me');
    expect(user.role).toBe('CUSTOMER');
    expect(user.isActive).toBe(true);
    expect((await agent.get('/api/admin/dashboard')).status).toBe(403);
  });

  it('validates phone and avatar', async () => {
    const agent = await registerAndLogin({ name: 'U', email: uniqueEmail('pf-val'), role: 'CUSTOMER' });
    expect((await agent.put('/api/auth/me').send({ phone: 'abc' })).status).toBe(422);
    expect((await agent.put('/api/auth/me').send({ name: '   ' })).status).toBe(422);
    for (const avatar of ['javascript:alert(1)', 'http://insecure.example.com/a.png', 'data:image/png;base64,AAA', '/uploads/../secret', 'ftp://x/y.png']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await agent.put('/api/auth/me').send({ avatar })).status).toBe(422);
    }
  });

  it('accepts an https avatar, and clears it with an empty string', async () => {
    const agent = await registerAndLogin({ name: 'U', email: uniqueEmail('pf-av'), role: 'CUSTOMER' });
    expect((await agent.put('/api/auth/me').send({ avatar: 'https://cdn.example.com/a.png' })).body.data.user.avatar).toBe('https://cdn.example.com/a.png');
    expect((await agent.put('/api/auth/me').send({ avatar: '' })).body.data.user.avatar).toBe('');
  });

  it('isSafeAvatar accepts only uploads paths and https URLs', () => {
    expect(isSafeAvatar('/uploads/a-b_c.1.webp')).toBe(true);
    expect(isSafeAvatar('https://x.example.com/a.png')).toBe(true);
    expect(isSafeAvatar('/uploads/sub/dir.png')).toBe(false);
    expect(isSafeAvatar('//evil.example.com/a.png')).toBe(false);
    expect(isSafeAvatar(123)).toBe(false);
    expect(isSafeAvatar(`https://x.example.com/${'a'.repeat(600)}`)).toBe(false);
  });

  describe('changing email', () => {
    it('requires the current password — and reports a wrong one as 400, never 401 (which would log the user out)', async () => {
      const email = uniqueEmail('pf-em');
      const agent = await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
      const missing = await agent.put('/api/auth/me').send({ email: uniqueEmail('new') });
      expect(missing.status).toBe(400);
      const wrong = await agent.put('/api/auth/me').send({ email: uniqueEmail('new'), currentPassword: 'wrong-password' });
      expect(wrong.status).toBe(400);
      expect((await User.findOne({ email })).email).toBe(email); // unchanged
      expect((await agent.get('/api/auth/me')).status).toBe(200); // still signed in
    });

    it('changes the email with the right password, then only the new email can log in', async () => {
      const oldEmail = uniqueEmail('pf-old');
      const newEmail = uniqueEmail('pf-new');
      const agent = await registerAndLogin({ name: 'U', email: oldEmail, role: 'CUSTOMER' });
      const res = await agent.put('/api/auth/me').send({ email: newEmail, currentPassword: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe(newEmail);
      expect((await login(newEmail, 'password123')).status).toBe(200);
      expect((await login(oldEmail, 'password123')).status).toBe(401);
    });

    it('audits the change without storing either address', async () => {
      const agent = await registerAndLogin({ name: 'U', email: uniqueEmail('pf-au'), role: 'CUSTOMER' });
      const newEmail = uniqueEmail('pf-au2');
      await agent.put('/api/auth/me').send({ email: newEmail, currentPassword: 'password123' }).expect(200);
      const entries = await AuditLog.find({ action: 'auth.email_change' });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).not.toContain(newEmail);
    });

    it('rejects an email that another account already uses', async () => {
      const taken = uniqueEmail('pf-taken');
      await registerAndLogin({ name: 'Other', email: taken, role: 'CUSTOMER' });
      const agent = await registerAndLogin({ name: 'U', email: uniqueEmail('pf-dup'), role: 'CUSTOMER' });
      const res = await agent.put('/api/auth/me').send({ email: taken, currentPassword: 'password123' });
      expect(res.status).toBe(409);
    });

    it('needs no password when the email is unchanged', async () => {
      const email = uniqueEmail('pf-same');
      const agent = await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
      expect((await agent.put('/api/auth/me').send({ email, name: 'Renamed' })).status).toBe(200);
    });
  });
});

describe('POST /api/auth/change-password', () => {
  it('rejects a wrong current password with 400 (not 401) and leaves the password alone', async () => {
    const email = uniqueEmail('cp-wrong');
    const agent = await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
    const res = await agent.post('/api/auth/change-password').send({ currentPassword: 'nope-nope', newPassword: 'brand-new-pass' });
    expect(res.status).toBe(400);
    expect((await login(email, 'password123')).status).toBe(200);
  });

  it('rejects a weak, too-long or unchanged new password', async () => {
    const agent = await registerAndLogin({ name: 'U', email: uniqueEmail('cp-val'), role: 'CUSTOMER' });
    expect((await agent.post('/api/auth/change-password').send({ currentPassword: 'password123', newPassword: 'short' })).status).toBe(422);
    expect((await agent.post('/api/auth/change-password').send({ currentPassword: 'password123', newPassword: 'x'.repeat(73) })).status).toBe(422);
    expect((await agent.post('/api/auth/change-password').send({ currentPassword: 'password123', newPassword: 'password123' })).status).toBe(400);
  });

  it('requires authentication', async () => {
    expect((await request(app).post('/api/auth/change-password').send({ currentPassword: 'a', newPassword: 'bbbbbbbb' })).status).toBe(401);
  });

  it('changes the password, keeps this device signed in, and emails a notification', async () => {
    const email = uniqueEmail('cp-ok');
    const agent = await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
    const res = await agent.post('/api/auth/change-password').send({ currentPassword: 'password123', newPassword: 'brand-new-pass' });
    expect(res.status).toBe(200);

    expect((await login(email, 'password123')).status).toBe(401);
    expect((await login(email, 'brand-new-pass')).status).toBe(200);
    expect((await agent.get('/api/auth/me')).status).toBe(200); // re-issued cookie

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toMatchObject({ to: email, subject: 'Your FoodRush password was changed' });
    expect(await AuditLog.countDocuments({ action: 'auth.password_change' })).toBe(1);
  });

  it('signs out every other session that was issued before the change', async () => {
    const email = uniqueEmail('cp-rev');
    const agent = await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
    const user = await User.findOne({ email });
    // A token from "another device", issued 30 seconds ago.
    const oldToken = jwt.sign({ sub: user._id.toString(), role: user.role, iat: Math.floor(Date.now() / 1000) - 30 }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(200);

    await agent.post('/api/auth/change-password').send({ currentPassword: 'password123', newPassword: 'brand-new-pass' }).expect(200);

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
  });

  it('a revoked session is also ignored on public routes that read optional auth', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('cp-opt'), role: 'RESTAURANT_OWNER' });
    const created = await owner.post('/api/restaurants').send({
      name: 'Hidden Place', cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Pune', deliveryTime: 20,
    });
    const id = created.body.data.restaurant._id;
    // An unapproved restaurant is visible only to its own (valid) session.
    expect((await owner.get(`/api/restaurants/${id}`)).status).toBe(200);

    // Simulate the password having been changed after this cookie was issued.
    await User.updateOne({ role: 'RESTAURANT_OWNER' }, { passwordChangedAt: new Date(Date.now() + 5000) });

    expect((await owner.get(`/api/restaurants/${id}`)).status).toBe(404);
  });
});
