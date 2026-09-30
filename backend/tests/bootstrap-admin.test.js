require('./setup');
const { bootstrapSuperAdmin } = require('../scripts/bootstrap-super-admin');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');

describe('bootstrap-super-admin script', () => {
  it('changes nothing in a dry run', async () => {
    await User.create({ name: 'Existing', email: 'boss@corp.test', password: 'password123', role: 'ADMIN' });
    const lines = [];
    const result = await bootstrapSuperAdmin({ email: 'boss@corp.test', apply: false, log: (l) => lines.push(l) });

    expect(result).toEqual({ action: 'promote', applied: false });
    expect(lines.join(' ')).toMatch(/Would promote/);
    expect((await User.findOne({ email: 'boss@corp.test' })).role).toBe('ADMIN');
    expect(await AuditLog.countDocuments({})).toBe(0);
  });

  it('promotes an existing user without touching their password, and audits it', async () => {
    const created = await User.create({ name: 'Existing', email: 'boss@corp.test', password: 'password123', role: 'ADMIN' });
    const before = (await User.findById(created._id).select('+password')).password;

    await bootstrapSuperAdmin({ email: 'BOSS@corp.test ', apply: true });

    const after = await User.findById(created._id).select('+password');
    expect(after.role).toBe('SUPER_ADMIN');
    expect(after.password).toBe(before);
    const log = await AuditLog.findOne({ action: 'super_admin.bootstrap' });
    expect(log.metadata).toEqual({ mode: 'promote', previousRole: 'ADMIN' });
  });

  it('only ever modifies the one matching user', async () => {
    await User.create({ name: 'A', email: 'a@corp.test', password: 'password123', role: 'CUSTOMER' });
    await User.create({ name: 'B', email: 'b@corp.test', password: 'password123', role: 'ADMIN' });
    await bootstrapSuperAdmin({ email: 'a@corp.test', apply: true });

    expect((await User.findOne({ email: 'a@corp.test' })).role).toBe('SUPER_ADMIN');
    expect((await User.findOne({ email: 'b@corp.test' })).role).toBe('ADMIN');
    expect(await User.countDocuments({})).toBe(2);
  });

  it('requires a 12+ character password to create a new account, and never logs it', async () => {
    await expect(bootstrapSuperAdmin({ email: 'new@corp.test', apply: true })).rejects.toThrow(/SUPER_ADMIN_PASSWORD is required/);
    await expect(bootstrapSuperAdmin({ email: 'new@corp.test', password: 'short', apply: true })).rejects.toThrow(/at least 12/);
    expect(await User.countDocuments({})).toBe(0);

    const lines = [];
    const password = 'a-long-secret-password-1';
    await bootstrapSuperAdmin({ email: 'new@corp.test', password, apply: true, log: (l) => lines.push(l) });

    const user = await User.findOne({ email: 'new@corp.test' }).select('+password');
    expect(user.role).toBe('SUPER_ADMIN');
    expect(await user.comparePassword(password)).toBe(true);
    expect(lines.join('\n')).not.toContain(password);
    expect(JSON.stringify(await AuditLog.find({}))).not.toContain(password);
  });

  it('rejects a missing or malformed email', async () => {
    await expect(bootstrapSuperAdmin({ email: '', apply: true })).rejects.toThrow(/valid email/);
    await expect(bootstrapSuperAdmin({ email: 'nope', apply: true })).rejects.toThrow(/valid email/);
  });

  it('is a no-op for an account that is already a SUPER_ADMIN', async () => {
    await User.create({ name: 'S', email: 's@corp.test', password: 'password123', role: 'SUPER_ADMIN' });
    expect(await bootstrapSuperAdmin({ email: 's@corp.test', apply: true })).toEqual({ action: 'none', applied: false });
    expect(await AuditLog.countDocuments({})).toBe(0);
  });
});
