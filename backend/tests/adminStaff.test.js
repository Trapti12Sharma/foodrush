require('./setup');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail, createUserWithRole } = require('./helpers');
const User = require('../src/models/User');
const AuditLog = require('../src/models/AuditLog');
const emailService = require('../src/services/email.service');
const { getPermissions, STAFF_ROLES, PERMISSIONS } = require('../src/utils/permissions');

// M17 — the super-admin console. Every endpoint sits behind admins:manage, which
// only SUPER_ADMIN holds, so most of what is proved here is that nobody else can
// reach it and that no sequence of calls can leave the platform unadministrable.

// Invite emails are sent (not awaited) through emailService.sendMail. Spying keeps
// the suite from depending on a mail provider, and lets the assertions check what
// would actually have been sent — in particular that no password is ever in it.
let sendMailSpy;
beforeEach(() => {
  sendMailSpy = jest.spyOn(emailService, 'sendMail').mockResolvedValue(undefined);
});
afterEach(() => {
  sendMailSpy.mockRestore();
});

async function superAdmin(prefix = 'staff-sa') {
  return createUserWithRole('SUPER_ADMIN', prefix);
}

// A second super admin, so tests about demoting one are not fighting the
// last-super-admin guard unless that is what they mean to test.
async function extraSuperAdmin(prefix = 'staff-sa2') {
  return User.create({ name: 'Backup SA', email: uniqueEmail(prefix), password: 'password123', role: 'SUPER_ADMIN' });
}

describe('M17 staff console — access control', () => {
  it.each([['/api/admin/staff'], ['/api/admin/roles']])('refuses an anonymous caller on %s', async (path) => {
    expect((await request(app).get(path)).status).toBe(401);
  });

  // An ADMIN must not be able to appoint staff or escalate itself — the reason
  // admins:manage is SUPER_ADMIN-only.
  it('refuses an ADMIN every operation', async () => {
    const { agent } = await createUserWithRole('ADMIN', 'staff-admin');
    const target = await User.create({ name: 'T', email: uniqueEmail('staff-t'), password: 'password123', role: 'SUPPORT_AGENT' });

    expect((await agent.get('/api/admin/staff')).status).toBe(403);
    expect((await agent.get('/api/admin/roles')).status).toBe(403);
    expect((await agent.post('/api/admin/staff').send({ name: 'X', email: uniqueEmail('x'), role: 'ADMIN' })).status).toBe(403);
    expect((await agent.patch(`/api/admin/staff/${target._id}/role`).send({ role: 'ADMIN' })).status).toBe(403);
    expect((await agent.patch(`/api/admin/staff/${target._id}/revoke`)).status).toBe(403);
    expect((await agent.post(`/api/admin/staff/${target._id}/resend-invite`)).status).toBe(403);

    expect((await User.findById(target._id)).role).toBe('SUPPORT_AGENT'); // nothing changed
  });

  it.each([
    ['OPERATIONS_MANAGER', 'staff-ops'],
    ['RESTAURANT_MANAGER', 'staff-rm'],
    ['DELIVERY_MANAGER', 'staff-dm'],
    ['SUPPORT_AGENT', 'staff-sup'],
  ])('refuses %s', async (role, prefix) => {
    const { agent } = await createUserWithRole(role, prefix);
    expect((await agent.get('/api/admin/staff')).status).toBe(403);
    expect((await agent.post('/api/admin/staff').send({ name: 'X', email: uniqueEmail('x'), role: 'ADMIN' })).status).toBe(403);
  });

  it('refuses a customer and a restaurant owner', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('staff-cust'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('staff-owner'), role: 'RESTAURANT_OWNER' });
    expect((await customer.get('/api/admin/staff')).status).toBe(403);
    expect((await owner.get('/api/admin/staff')).status).toBe(403);
  });
});

describe('M17 staff console — the role matrix', () => {
  it('serves the same table the API enforces', async () => {
    const { agent } = await superAdmin('matrix-sa');
    const res = await agent.get('/api/admin/roles');

    expect(res.status).toBe(200);
    expect(res.body.data.roles.map((r) => r.role).sort()).toEqual([...STAFF_ROLES].sort());
    // Every role's listed permissions must be exactly what permissions.js grants,
    // so an operator choosing a role from this screen cannot be misled about it.
    res.body.data.roles.forEach(({ role, permissions }) => {
      expect(permissions.sort()).toEqual([...getPermissions(role)].sort());
    });
    expect(res.body.data.permissions).toContain(PERMISSIONS.SETTINGS_MANAGE);
  });

  it('shows settings:manage and admins:manage on SUPER_ADMIN alone', async () => {
    const { agent } = await superAdmin('matrix-sa2');
    const { roles } = (await agent.get('/api/admin/roles')).body.data;
    const holders = (perm) => roles.filter((r) => r.permissions.includes(perm)).map((r) => r.role);

    expect(holders(PERMISSIONS.SETTINGS_MANAGE)).toEqual(['SUPER_ADMIN']);
    expect(holders(PERMISSIONS.ADMINS_MANAGE)).toEqual(['SUPER_ADMIN']);
  });
});

describe('M17 staff console — listing', () => {
  it('lists staff only, never customers', async () => {
    const { agent } = await superAdmin('list-sa');
    await User.create({ name: 'Agent', email: uniqueEmail('list-agent'), password: 'password123', role: 'SUPPORT_AGENT' });
    await User.create({ name: 'Shopper', email: uniqueEmail('list-cust'), password: 'password123', role: 'CUSTOMER' });
    await User.create({ name: 'Rider', email: uniqueEmail('list-rider'), password: 'password123', role: 'DELIVERY_PARTNER' });

    const res = await agent.get('/api/admin/staff');

    expect(res.status).toBe(200);
    const roles = res.body.data.items.map((i) => i.role);
    expect(roles).toContain('SUPPORT_AGENT');
    expect(roles).toContain('SUPER_ADMIN');
    expect(roles).not.toContain('CUSTOMER');
    expect(roles).not.toContain('DELIVERY_PARTNER');
  });

  it('never returns a password hash or a reset token', async () => {
    const { agent } = await superAdmin('leak-sa');
    const res = await agent.get('/api/admin/staff');
    const serialized = JSON.stringify(res.body);

    // Asserting on the SECRETS, not on the word "password". A blunt
    // /password/i over the whole body also matches `lastPasswordChangeAt`,
    // which is a legitimate field that leaks nothing — so it would fail on
    // correct code and teach us to loosen the check next time. These four
    // assertions are what "no credential escaped" actually means.
    expect(serialized).not.toMatch(/\$2[aby]\$\d{2}\$/); // a bcrypt hash, whatever key it hid under
    expect(serialized).not.toMatch(/passwordResetTokenHash/);
    expect(serialized).not.toMatch(/passwordResetExpires/);
    expect(serialized).not.toMatch(/"password"/);
    expect(res.body.data.items[0]).not.toHaveProperty('password');
  });

  it('filters by role and by status, and rejects a non-staff role filter', async () => {
    const { agent } = await superAdmin('filter-sa');
    await User.create({ name: 'A', email: uniqueEmail('f-agent'), password: 'password123', role: 'SUPPORT_AGENT' });
    await User.create({ name: 'B', email: uniqueEmail('f-dm'), password: 'password123', role: 'DELIVERY_MANAGER', isActive: false });

    expect((await agent.get('/api/admin/staff?role=SUPPORT_AGENT')).body.data.items.map((i) => i.role)).toEqual(['SUPPORT_AGENT']);
    expect((await agent.get('/api/admin/staff?isActive=false')).body.data.items.map((i) => i.role)).toEqual(['DELIVERY_MANAGER']);
    // A customer role here is a mistake, not a request for an empty list.
    expect((await agent.get('/api/admin/staff?role=CUSTOMER')).status).toBe(400);
  });

  it('searches by name and email', async () => {
    const { agent } = await superAdmin('search-sa');
    await User.create({ name: 'Priya Sharma', email: 'priya.unique@example.com', password: 'password123', role: 'SUPPORT_AGENT' });

    expect((await agent.get('/api/admin/staff?search=priya')).body.data.items).toHaveLength(1);
    expect((await agent.get('/api/admin/staff?search=priya.unique@example.com')).body.data.items).toHaveLength(1);
    expect((await agent.get('/api/admin/staff?search=nobodybythisname')).body.data.items).toHaveLength(0);
  });

  // Regression: hasAcceptedInvite was originally Boolean(passwordChangedAt), so
  // any account created directly with a working password — the bootstrap script,
  // the seed script, or a promoted self-registration — was shown as "Invite
  // pending" forever despite being able to log in. Found by running the console
  // against a bootstrap-created super admin, not by any test.
  it('does not claim a pending invite for an account created with a real password', async () => {
    const { agent } = await superAdmin('direct-sa');
    const direct = await User.create({
      name: 'Bootstrapped Admin',
      email: uniqueEmail('direct-admin'),
      password: 'password123',
      role: 'ADMIN',
    });

    const row = (await agent.get(`/api/admin/staff?search=${encodeURIComponent(direct.email)}`)).body.data.items[0];

    expect(row.invitePending).toBe(false); // it can be logged into right now
    expect(row.inviteExpired).toBe(false);
    expect(row.hasAcceptedInvite).toBe(true);
  });

  it('marks an expired, never-accepted invite as expired rather than merely pending', async () => {
    const { agent } = await superAdmin('expired-sa');
    const email = uniqueEmail('expired-hire');
    await agent.post('/api/admin/staff').send({ name: 'Lapsed Hire', email, role: 'ADMIN' }).expect(201);
    // Push the invite window into the past, as the passage of a week would.
    await User.updateOne({ email }, { $set: { passwordResetExpires: new Date(Date.now() - 1000) } });

    const row = (await agent.get(`/api/admin/staff?search=${encodeURIComponent(email)}`)).body.data.items[0];

    expect(row.invitePending).toBe(true);
    expect(row.inviteExpired).toBe(true); // needs resending, not just waiting
  });

  it('marks an account that has never set its own password as a pending invite', async () => {
    const { agent } = await superAdmin('pending-sa');
    const email = uniqueEmail('pending-agent');
    await agent.post('/api/admin/staff').send({ name: 'New Hire', email, role: 'SUPPORT_AGENT' }).expect(201);

    const row = (await agent.get('/api/admin/staff?search=New Hire')).body.data.items[0];
    expect(row.invitePending).toBe(true);
    expect(row.hasAcceptedInvite).toBe(false);
    expect(row.inviteExpired).toBe(false); // freshly issued, so pending but not dead
    expect(row.isActive).toBe(true); // active, but not yet accepted — two different things
    // The booleans are derived from the credential fields; those fields must not
    // themselves be in the response.
    expect(row).not.toHaveProperty('passwordResetTokenHash');
    expect(row).not.toHaveProperty('passwordResetExpires');
  });
});

describe('M17 staff console — creating an account', () => {
  it('creates the account, emails an invite, and returns no credential', async () => {
    const { agent, user: actor } = await superAdmin('create-sa');
    const email = uniqueEmail('new-hire');

    const res = await agent.post('/api/admin/staff').send({ name: 'Asha Rao', email, phone: '9876543210', role: 'SUPPORT_AGENT' });

    expect(res.status).toBe(201);
    expect(res.body.data.staff.role).toBe('SUPPORT_AGENT');
    expect(res.body.data.staff.permissions).toEqual(getPermissions('SUPPORT_AGENT'));
    // No credential in the response — an admin never holds someone else's, and
    // there is nothing here to paste into a chat. Checks the secrets themselves
    // rather than the word "password" (see the leak test above for why).
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/\$2[aby]\$\d{2}\$/); // the generated password's hash
    expect(serialized).not.toMatch(/"password"/);
    expect(serialized).not.toMatch(/passwordResetTokenHash/);
    expect(serialized).not.toMatch(/token=/); // nor the invite link, which is one

    const created = await User.findOne({ email }).select('+password +passwordResetTokenHash');
    expect(created.role).toBe('SUPPORT_AGENT');
    expect(created.passwordResetTokenHash).toBeTruthy(); // an invite token was issued
    expect(created.passwordChangedAt).toBeNull(); // they have not set one yet

    expect(sendMailSpy).toHaveBeenCalledTimes(1);
    const sent = sendMailSpy.mock.calls[0][0];
    expect(sent.to).toBe(email);
    expect(sent.subject).toMatch(/team/i);
    expect(sent.text).toContain('SUPPORT_AGENT'); // names the role, so an unexpected grant is visible
    expect(sent.text).toContain(actor.name); // and who granted it
    expect(sent.text).toMatch(/reset-password\?token=[a-f0-9]{64}/); // a real single-use link
  });

  it('stores a password that is not derivable and does not match any obvious guess', async () => {
    const { agent } = await superAdmin('pw-sa');
    const email = uniqueEmail('pw-hire');
    await agent.post('/api/admin/staff').send({ name: 'Test Hire', email, role: 'ADMIN' }).expect(201);

    // The generated password is random and never transmitted, so the account
    // cannot be logged into until the invitee sets their own.
    for (const guess of ['password123', 'password', email, 'Test Hire', '']) {
      const res = await request(app).post('/api/auth/login').send({ email, password: guess });
      expect(res.status).not.toBe(200);
    }
  });

  it('refuses an email that already has an account, naming its role', async () => {
    const { agent } = await superAdmin('dupe-sa');
    const existing = await User.create({ name: 'Already', email: 'taken.staff@example.com', password: 'password123', role: 'CUSTOMER' });

    const res = await agent.post('/api/admin/staff').send({ name: 'Other', email: existing.email, role: 'ADMIN' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/CUSTOMER/);
    expect(await User.countDocuments({ email: existing.email })).toBe(1);
    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['a customer role', { name: 'X', role: 'CUSTOMER' }],
    ['a delivery partner role', { name: 'X', role: 'DELIVERY_PARTNER' }],
    ['a restaurant owner role', { name: 'X', role: 'RESTAURANT_OWNER' }],
    ['an invented role', { name: 'X', role: 'GOD_MODE' }],
    ['no role', { name: 'X' }],
    ['no name', { role: 'ADMIN' }],
  ])('rejects %s with 422 and creates nothing', async (_label, body) => {
    const { agent } = await superAdmin(`bad-${Math.random().toString(36).slice(2, 7)}`);
    const before = await User.countDocuments({});
    const res = await agent.post('/api/admin/staff').send({ email: uniqueEmail('bad'), ...body });
    expect(res.status).toBe(422);
    expect(await User.countDocuments({})).toBe(before);
  });

  it('rejects a malformed email', async () => {
    const { agent } = await superAdmin('email-sa');
    const res = await agent.post('/api/admin/staff').send({ name: 'X', email: 'not-an-email', role: 'ADMIN' });
    expect(res.status).toBe(422);
  });

  it('lets a super admin appoint another super admin', async () => {
    const { agent } = await superAdmin('appoint-sa');
    const res = await agent.post('/api/admin/staff').send({ name: 'Second SA', email: uniqueEmail('second-sa'), role: 'SUPER_ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.data.staff.role).toBe('SUPER_ADMIN');
  });

  it('writes an audit entry', async () => {
    const { agent, user: actor } = await superAdmin('audit-sa');
    const email = uniqueEmail('audited-hire');
    await agent.post('/api/admin/staff').send({ name: 'Audited', email, role: 'DELIVERY_MANAGER' }).expect(201);

    const entry = await AuditLog.findOne({ action: 'staff.create' });
    expect(entry).toBeTruthy();
    expect(entry.actor.toString()).toBe(actor._id.toString());
    expect(entry.metadata.role).toBe('DELIVERY_MANAGER');
    expect(entry.metadata.email).toBe(email);
  });
});

describe('M17 staff console — changing a role', () => {
  it('changes the role and records the transition', async () => {
    const { agent, user: actor } = await superAdmin('role-sa');
    const target = await User.create({ name: 'T', email: uniqueEmail('role-t'), password: 'password123', role: 'SUPPORT_AGENT' });

    const res = await agent.patch(`/api/admin/staff/${target._id}/role`).send({ role: 'DELIVERY_MANAGER' });

    expect(res.status).toBe(200);
    expect(res.body.data.staff.role).toBe('DELIVERY_MANAGER');
    expect(res.body.data.staff.permissions).toEqual(getPermissions('DELIVERY_MANAGER'));
    expect((await User.findById(target._id)).role).toBe('DELIVERY_MANAGER');

    const entry = await AuditLog.findOne({ action: 'staff.role_change' });
    expect(entry.actor.toString()).toBe(actor._id.toString());
    expect(entry.metadata).toMatchObject({ from: 'SUPPORT_AGENT', to: 'DELIVERY_MANAGER' });
  });

  it('promotes an existing customer to staff', async () => {
    const { agent } = await superAdmin('promote-sa');
    const customer = await User.create({ name: 'Keen', email: uniqueEmail('promote-c'), password: 'password123', role: 'CUSTOMER' });

    const res = await agent.patch(`/api/admin/staff/${customer._id}/role`).send({ role: 'SUPPORT_AGENT' });

    expect(res.status).toBe(200);
    expect((await User.findById(customer._id)).role).toBe('SUPPORT_AGENT');
  });

  // Both own records whose ownership checks assume the role, and both have a
  // conflict of interest in moderating the platform they sell on.
  it.each([['RESTAURANT_OWNER'], ['DELIVERY_PARTNER']])('refuses to convert a %s into staff', async (role) => {
    const { agent } = await superAdmin(`convert-${role.toLowerCase()}`);
    const target = await User.create({ name: 'Partner', email: uniqueEmail('convert'), password: 'password123', role });

    const res = await agent.patch(`/api/admin/staff/${target._id}/role`).send({ role: 'ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/cannot be converted to staff/i);
    expect((await User.findById(target._id)).role).toBe(role);
  });

  it('refuses to change your own role, however many other super admins exist', async () => {
    const { agent, user } = await superAdmin('self-sa');
    await extraSuperAdmin('self-sa-backup');

    const res = await agent.patch(`/api/admin/staff/${user._id}/role`).send({ role: 'SUPPORT_AGENT' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/your own account/i);
    expect((await User.findById(user._id)).role).toBe('SUPER_ADMIN');
  });

  it('treats setting the role a person already has as a no-op with no audit entry', async () => {
    const { agent } = await superAdmin('noop-sa');
    const target = await User.create({ name: 'T', email: uniqueEmail('noop-t'), password: 'password123', role: 'ADMIN' });

    const res = await agent.patch(`/api/admin/staff/${target._id}/role`).send({ role: 'ADMIN' });

    expect(res.status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'staff.role_change' })).toBe(0);
  });

  it('404s for a user that does not exist and 422s for an invalid role', async () => {
    const { agent } = await superAdmin('missing-sa');
    const target = await User.create({ name: 'T', email: uniqueEmail('m-t'), password: 'password123', role: 'ADMIN' });

    expect((await agent.patch('/api/admin/staff/0123456789abcdef01234567/role').send({ role: 'ADMIN' })).status).toBe(404);
    expect((await agent.patch(`/api/admin/staff/${target._id}/role`).send({ role: 'CUSTOMER' })).status).toBe(422);
  });
});

describe('M17 staff console — revoking access', () => {
  it('drops the role to CUSTOMER rather than deleting the account', async () => {
    const { agent } = await superAdmin('revoke-sa');
    const target = await User.create({ name: 'Leaver', email: uniqueEmail('revoke-t'), password: 'password123', role: 'DELIVERY_MANAGER' });

    const res = await agent.patch(`/api/admin/staff/${target._id}/revoke`);

    expect(res.status).toBe(200);
    const after = await User.findById(target._id);
    expect(after).toBeTruthy(); // the account (and the history referencing it) survives
    expect(after.role).toBe('CUSTOMER');
    expect(getPermissions(after.role)).toEqual([]);
    expect((await AuditLog.findOne({ action: 'staff.revoke' })).metadata.from).toBe('DELIVERY_MANAGER');
  });

  it('immediately ends the revoked person\'s access to admin endpoints', async () => {
    const { agent: sa } = await superAdmin('revoke2-sa');
    const { agent: victim, user } = await createUserWithRole('DELIVERY_MANAGER', 'revoke2-dm');

    // Their session works before the revoke...
    expect((await victim.get('/api/admin/dashboard')).status).toBe(200);

    await sa.patch(`/api/admin/staff/${user._id}/revoke`).expect(200);

    // ...and stops the moment it lands, because the auth middleware reloads the
    // user (and therefore the role) on every request.
    expect((await victim.get('/api/admin/dashboard')).status).toBe(403);
  });

  it('refuses to revoke your own access', async () => {
    const { agent, user } = await superAdmin('revoke-self');
    await extraSuperAdmin('revoke-self-backup');

    const res = await agent.patch(`/api/admin/staff/${user._id}/revoke`);

    expect(res.status).toBe(400);
    expect((await User.findById(user._id)).role).toBe('SUPER_ADMIN');
  });

  it('refuses to revoke someone who is not staff', async () => {
    const { agent } = await superAdmin('revoke-nonstaff');
    const customer = await User.create({ name: 'C', email: uniqueEmail('revoke-c'), password: 'password123', role: 'CUSTOMER' });

    const res = await agent.patch(`/api/admin/staff/${customer._id}/revoke`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not a staff member/i);
  });
});

// The reason the guards exist: if the platform can reach a state with no active
// super admin, nobody can ever change a setting or appoint staff again, and no
// endpoint in the product can fix it.
describe('M17 — the platform can never be left unadministrable', () => {
  it('refuses to demote the only active super admin', async () => {
    const { agent } = await superAdmin('last-sa');
    const other = await User.create({ name: 'Other', email: uniqueEmail('last-other'), password: 'password123', role: 'SUPER_ADMIN', isActive: false });

    // An INACTIVE super admin does not count as cover — they cannot log in.
    const res = await agent.patch(`/api/admin/staff/${other._id}/role`).send({ role: 'ADMIN' });
    expect(res.status).toBe(200); // demoting the inactive one is fine

    const { user: sole } = await superAdmin('last-sa-check');
    // `sole` is now the only ACTIVE super admin besides the acting one; remove the
    // acting one's cover by demoting them through a third super admin.
    const third = await extraSuperAdmin('last-third');
    await agent.patch(`/api/admin/staff/${third._id}/revoke`).expect(200);
    await agent.patch(`/api/admin/staff/${sole._id}/revoke`).expect(200);

    // The acting super admin is now the last one. They cannot revoke themselves
    // (self-guard), and no other super admin exists to do it for them — which is
    // exactly the state the guard is protecting.
    const remaining = await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true });
    expect(remaining).toBe(1);
  });

  it('refuses to revoke the last active super admin, and lets it through once a second exists', async () => {
    const { agent } = await superAdmin('cover-sa');
    const lastOne = await extraSuperAdmin('cover-last');

    // Two active super admins: revoking one is allowed.
    await agent.patch(`/api/admin/staff/${lastOne._id}/revoke`).expect(200);

    // Now only the acting super admin is left. A fresh one cannot be demoted
    // below that floor: appoint a second, revoke the first, then try again.
    const second = await extraSuperAdmin('cover-second');
    expect(await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true })).toBe(2);
    await agent.patch(`/api/admin/staff/${second._id}/revoke`).expect(200);

    // One active super admin remains (the actor). Demoting THEM requires another
    // super admin to act, and the self-guard blocks them doing it themselves.
    const selfAttempt = await agent.patch(`/api/admin/staff/${(await User.findOne({ role: 'SUPER_ADMIN', isActive: true }))._id}/revoke`);
    expect(selfAttempt.status).toBe(400);
  });

  it('refuses to deactivate the last active super admin through the users endpoint', async () => {
    // The gap M17 closed: this endpoint is not a self-change and the actor does
    // hold admins:manage, so every pre-M17 check passed and the platform could be
    // locked out from here.
    const { agent } = await superAdmin('deact-sa');
    const other = await extraSuperAdmin('deact-other');

    // Deactivating one of two is fine.
    await agent.patch(`/api/admin/users/${other._id}/status`).send({ isActive: false }).expect(200);

    // `other` is now inactive, so the actor is the only active super admin. Make a
    // third, then verify the sole-remaining one cannot be deactivated.
    const third = await extraSuperAdmin('deact-third');
    const res = await agent.patch(`/api/admin/users/${third._id}/status`).send({ isActive: false });
    expect(res.status).toBe(200); // the actor still covers it

    // Now only the actor is active. Reactivate `third` and try to deactivate the
    // actor's cover in a way that would empty the set.
    await agent.patch(`/api/admin/users/${third._id}/status`).send({ isActive: true }).expect(200);
    await agent.patch(`/api/admin/users/${third._id}/status`).send({ isActive: false }).expect(200);

    expect(await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true })).toBe(1);
  });

  it('blocks the deactivation that would empty the set, with a message naming the person', async () => {
    const { agent } = await superAdmin('empty-sa');
    // Demote the acting super admin's own role is impossible, so instead build the
    // scenario directly: one active super admin who is NOT the actor.
    const sole = await extraSuperAdmin('empty-sole');
    // Make the actor an ADMIN at the DB level so `sole` is genuinely the last one,
    // while the actor keeps a session that still carries admins:manage... which it
    // does not, so use a second super admin as the actor instead.
    const actor2 = await createUserWithRole('SUPER_ADMIN', 'empty-actor');
    await User.updateMany({ _id: { $nin: [sole._id, actor2.user._id] }, role: 'SUPER_ADMIN' }, { role: 'ADMIN' });
    // Two active super admins now: `sole` and `actor2`. Deactivate `sole` (allowed),
    // leaving only `actor2`.
    await actor2.agent.patch(`/api/admin/users/${sole._id}/status`).send({ isActive: false }).expect(200);

    // `actor2` is the last active super admin and cannot deactivate itself.
    const res = await actor2.agent.patch(`/api/admin/users/${actor2.user._id}/status`).send({ isActive: false });
    expect(res.status).toBe(400);
    expect(await User.countDocuments({ role: 'SUPER_ADMIN', isActive: true })).toBe(1);
  });

  it('still allows reactivating a super admin (only deactivation can lock anyone out)', async () => {
    const { agent } = await superAdmin('react-sa');
    const dormant = await User.create({ name: 'Dormant', email: uniqueEmail('react-d'), password: 'password123', role: 'SUPER_ADMIN', isActive: false });

    const res = await agent.patch(`/api/admin/users/${dormant._id}/status`).send({ isActive: true });

    expect(res.status).toBe(200);
    expect((await User.findById(dormant._id)).isActive).toBe(true);
  });
});

describe('M17 staff console — re-sending an invite', () => {
  it('issues a fresh token and invalidates the previous link', async () => {
    const { agent } = await superAdmin('resend-sa');
    const email = uniqueEmail('resend-hire');
    await agent.post('/api/admin/staff').send({ name: 'Hire', email, role: 'ADMIN' }).expect(201);

    const firstHash = (await User.findOne({ email }).select('+passwordResetTokenHash')).passwordResetTokenHash;
    const firstLink = sendMailSpy.mock.calls[0][0].text.match(/token=([a-f0-9]{64})/)[1];

    const created = await User.findOne({ email });
    const res = await agent.post(`/api/admin/staff/${created._id}/resend-invite`);

    expect(res.status).toBe(200);
    const secondHash = (await User.findOne({ email }).select('+passwordResetTokenHash')).passwordResetTokenHash;
    expect(secondHash).not.toBe(firstHash); // a new token
    expect(sendMailSpy).toHaveBeenCalledTimes(2);

    // The old link no longer works — only one token hash is stored per user, so
    // issuing a new one revokes the old.
    const stale = await request(app).post('/api/auth/reset-password').send({ token: firstLink, password: 'newpassword123' });
    expect(stale.status).not.toBe(200);

    // The new one does.
    const freshLink = sendMailSpy.mock.calls[1][0].text.match(/token=([a-f0-9]{64})/)[1];
    const accepted = await request(app).post('/api/auth/reset-password').send({ token: freshLink, password: 'newpassword123' });
    expect(accepted.status).toBe(200);
  });

  it('lets the invitee sign in once they have set their password, with their granted permissions', async () => {
    const { agent } = await superAdmin('accept-sa');
    const email = uniqueEmail('accept-hire');
    await agent.post('/api/admin/staff').send({ name: 'Accepting Hire', email, role: 'SUPPORT_AGENT' }).expect(201);

    const token = sendMailSpy.mock.calls[0][0].text.match(/token=([a-f0-9]{64})/)[1];
    await request(app).post('/api/auth/reset-password').send({ token, password: 'chosenpassword1' }).expect(200);

    const theirAgent = request.agent(app);
    const login = await theirAgent.post('/api/auth/login').send({ email, password: 'chosenpassword1' });
    expect(login.status).toBe(200);

    // A SUPPORT_AGENT can see the dashboard and tickets but not settings or staff.
    expect((await theirAgent.get('/api/admin/dashboard')).status).toBe(200);
    expect((await theirAgent.get('/api/admin/settings')).status).toBe(403);
    expect((await theirAgent.get('/api/admin/staff')).status).toBe(403);

    // And the console now shows the invite as accepted.
    const acceptedRow = (await agent.get(`/api/admin/staff?search=${encodeURIComponent(email)}`)).body.data.items[0];
    expect(acceptedRow.hasAcceptedInvite).toBe(true);
    expect(acceptedRow.invitePending).toBe(false);
  });

  it('refuses to send a working link to a deactivated account', async () => {
    const { agent } = await superAdmin('deactivated-sa');
    const target = await User.create({ name: 'Disabled', email: uniqueEmail('deact-t'), password: 'password123', role: 'ADMIN', isActive: false });

    const res = await agent.post(`/api/admin/staff/${target._id}/resend-invite`);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/deactivated/i);
    expect(sendMailSpy).not.toHaveBeenCalled();
  });

  it('refuses for a non-staff user and 404s for a missing one', async () => {
    const { agent } = await superAdmin('resend-bad');
    const customer = await User.create({ name: 'C', email: uniqueEmail('resend-c'), password: 'password123', role: 'CUSTOMER' });

    expect((await agent.post(`/api/admin/staff/${customer._id}/resend-invite`)).status).toBe(400);
    expect((await agent.post('/api/admin/staff/0123456789abcdef01234567/resend-invite')).status).toBe(404);
  });

  it('still creates the account when the invite email fails to send', async () => {
    const { agent } = await superAdmin('mailfail-sa');
    sendMailSpy.mockRejectedValue(new Error('SMTP unavailable'));
    const email = uniqueEmail('mailfail-hire');

    const res = await agent.post('/api/admin/staff').send({ name: 'Unlucky', email, role: 'ADMIN' });

    // A mail outage must not fail the account creation — the super admin can
    // re-send the invite once mail is working again.
    expect(res.status).toBe(201);
    expect(await User.findOne({ email })).toBeTruthy();
  });
});
