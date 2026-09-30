require('./setup');
const crypto = require('crypto');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail } = require('./helpers');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const emailService = require('../src/services/email.service');

let sendSpy;
beforeEach(() => {
  sendSpy = jest.spyOn(emailService, 'sendMail').mockResolvedValue(undefined);
});
afterEach(() => {
  sendSpy.mockRestore();
  delete process.env.APP_URL;
});

const forgot = (email) => request(app).post('/api/auth/forgot-password').send({ email });
const reset = (token, password) => request(app).post('/api/auth/reset-password').send({ token, password });
const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const tokenFromEmail = (call = 0) => /token=([a-f0-9]{64})/.exec(sendSpy.mock.calls[call][0].text)[1];

async function userWithResetToken(prefix = 'rs') {
  const email = uniqueEmail(prefix);
  await registerAndLogin({ name: 'Reset Me', email, role: 'CUSTOMER' });
  await forgot(email).expect(200);
  return { email, token: tokenFromEmail(0) };
}

describe('POST /api/auth/forgot-password', () => {
  it('gives the identical response for a registered and an unregistered email (no account enumeration)', async () => {
    const known = uniqueEmail('fp-known');
    await registerAndLogin({ name: 'K', email: known, role: 'CUSTOMER' });

    const a = await forgot(known);
    const b = await forgot(uniqueEmail('fp-nobody'));
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    expect(a.body.message).toMatch(/if an account exists/i);
  });

  it('emails only registered, active accounts', async () => {
    await forgot(uniqueEmail('fp-none')).expect(200);
    expect(sendSpy).not.toHaveBeenCalled();

    const inactive = uniqueEmail('fp-off');
    await registerAndLogin({ name: 'Off', email: inactive, role: 'CUSTOMER' });
    await User.updateOne({ email: inactive }, { isActive: false });
    await forgot(inactive).expect(200);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('sends one email with a single-use link, and stores only the hash of the token', async () => {
    const { email, token } = await userWithResetToken('fp-hash');
    expect(sendSpy).toHaveBeenCalledTimes(1);
    const message = sendSpy.mock.calls[0][0];
    expect(message.to).toBe(email);
    expect(message.text).toMatch(/\/reset-password\?token=[a-f0-9]{64}/);
    expect(message.html).toContain(`token=${token}`);

    const stored = await User.findOne({ email }).select('+passwordResetTokenHash +passwordResetExpires');
    expect(stored.passwordResetTokenHash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(token);
    const ttlMinutes = (stored.passwordResetExpires.getTime() - Date.now()) / 60000;
    expect(ttlMinutes).toBeGreaterThan(28);
    expect(ttlMinutes).toBeLessThanOrEqual(30);
  });

  it('never leaks reset state through the API', async () => {
    const { email } = await userWithResetToken('fp-leak');
    const agent = await login(email, 'password123');
    const me = await request(app).get('/api/auth/me').set('Cookie', agent.headers['set-cookie']);
    expect(JSON.stringify(me.body)).not.toMatch(/passwordReset/);
  });

  it('allows one reset email per minute per account', async () => {
    const email = uniqueEmail('fp-cool');
    await registerAndLogin({ name: 'C', email, role: 'CUSTOMER' });
    await forgot(email).expect(200);
    await forgot(email).expect(200);
    await forgot(email).expect(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // ...and works again once the cooldown has passed.
    await User.updateOne({ email }, { passwordResetRequestedAt: new Date(Date.now() - 61000) });
    await forgot(email).expect(200);
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('builds the link from APP_URL when set, else from CLIENT_URL', async () => {
    process.env.APP_URL = 'https://app.foodrush.example.com/some/path';
    const email = uniqueEmail('fp-url');
    await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
    await forgot(email).expect(200);
    expect(sendSpy.mock.calls[0][0].text).toContain('https://app.foodrush.example.com/reset-password?token=');
  });

  it('still answers 200 when the email provider fails, and never logs the token', async () => {
    sendSpy.mockRejectedValue(new Error('smtp down'));
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const email = uniqueEmail('fp-fail');
    await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });

    const res = await forgot(email);
    await new Promise((resolve) => setImmediate(resolve));
    expect(res.status).toBe(200);
    expect(errSpy).toHaveBeenCalled();
    const stored = await User.findOne({ email }).select('+passwordResetTokenHash');
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(stored.passwordResetTokenHash);
    expect(JSON.stringify(errSpy.mock.calls)).not.toMatch(/token=/);
    errSpy.mockRestore();
  });

  it('validates the email format', async () => {
    expect((await request(app).post('/api/auth/forgot-password').send({ email: 'not-an-email' })).status).toBe(422);
    expect((await request(app).post('/api/auth/forgot-password').send({})).status).toBe(422);
  });
});

describe('POST /api/auth/reset-password', () => {
  it('sets the new password, invalidates the old one, and notifies the owner', async () => {
    const { email, token } = await userWithResetToken('rs-ok');
    const res = await reset(token, 'a-brand-new-password');
    expect(res.status).toBe(200);

    expect((await login(email, 'password123')).status).toBe(401);
    expect((await login(email, 'a-brand-new-password')).status).toBe(200);

    expect(sendSpy).toHaveBeenCalledTimes(2); // the reset link, then the "password changed" notice
    expect(sendSpy.mock.calls[1][0]).toMatchObject({ to: email, subject: 'Your FoodRush password was changed' });
    expect(await AuditLog.countDocuments({ action: 'auth.password_reset' })).toBe(1);
  });

  it('token is single-use, and the reset state is cleared', async () => {
    const { email, token } = await userWithResetToken('rs-once');
    await reset(token, 'first-new-password').expect(200);

    const again = await reset(token, 'second-new-password');
    expect(again.status).toBe(400);
    expect((await login(email, 'second-new-password')).status).toBe(401);
    expect((await login(email, 'first-new-password')).status).toBe(200);

    const stored = await User.findOne({ email }).select('+passwordResetTokenHash +passwordResetExpires');
    expect(stored.passwordResetTokenHash).toBeUndefined();
    expect(stored.passwordResetExpires).toBeUndefined();
  });

  it('lets only one of two simultaneous requests with the same token succeed', async () => {
    const { token } = await userWithResetToken('rs-race');
    const [a, b] = await Promise.all([reset(token, 'race-password-one'), reset(token, 'race-password-two')]);
    expect([a.status, b.status].sort()).toEqual([200, 400]);
  });

  it('rejects an expired token', async () => {
    const { email, token } = await userWithResetToken('rs-exp');
    await User.updateOne({ email }, { passwordResetExpires: new Date(Date.now() - 1000) });
    expect((await reset(token, 'some-new-password')).status).toBe(400);
    expect((await login(email, 'password123')).status).toBe(200); // password unchanged
  });

  it('rejects unknown, malformed and missing tokens without touching any account', async () => {
    const { email } = await userWithResetToken('rs-bad');
    expect((await reset(crypto.randomBytes(32).toString('hex'), 'some-new-password')).status).toBe(400); // well-formed, unknown
    expect((await reset('short', 'some-new-password')).status).toBe(422);
    expect((await reset('Z'.repeat(64), 'some-new-password')).status).toBe(422);
    expect((await request(app).post('/api/auth/reset-password').send({ password: 'some-new-password' })).status).toBe(422);
    expect((await login(email, 'password123')).status).toBe(200);
  });

  it('validates the new password length', async () => {
    const { token } = await userWithResetToken('rs-len');
    expect((await reset(token, 'short')).status).toBe(422);
    expect((await reset(token, 'x'.repeat(73))).status).toBe(422);
  });

  it('cannot reset an account that was deactivated after the link was sent', async () => {
    const { email, token } = await userWithResetToken('rs-off');
    await User.updateOne({ email }, { isActive: false });
    expect((await reset(token, 'some-new-password')).status).toBe(400);
  });

  it('signs out sessions that existed before the reset', async () => {
    const email = uniqueEmail('rs-sess');
    const agent = await registerAndLogin({ name: 'U', email, role: 'CUSTOMER' });
    const jwt = require('jsonwebtoken');
    const user = await User.findOne({ email });
    const oldToken = jwt.sign({ sub: user._id.toString(), role: user.role, iat: Math.floor(Date.now() / 1000) - 30 }, process.env.JWT_SECRET);
    expect((await agent.get('/api/auth/me')).status).toBe(200);

    await forgot(email).expect(200);
    await reset(tokenFromEmail(0), 'a-fresh-password').expect(200);

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
  });

  it('does not log the user in automatically', async () => {
    const { token } = await userWithResetToken('rs-noauto');
    const res = await reset(token, 'a-fresh-password');
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});
