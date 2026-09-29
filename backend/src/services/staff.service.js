const crypto = require('crypto');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const emailService = require('./email.service');
const auditService = require('./audit.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');
const { ROLES } = require('../utils/constants');
const { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, getPermissions, isStaffRole } = require('../utils/permissions');

// M17 — the super-admin console: who is on the FoodRush team and what each of
// them may do. Every operation here requires admins:manage, which only
// SUPER_ADMIN holds (see permissions.js), so this whole file is effectively
// super-admin-only — an ADMIN cannot grant themselves more power, which is the
// entire point of separating the two roles back in M0.
//
// Staff accounts are ordinary User documents with a staff role. There is no
// separate Staff collection on purpose: a staff member logs in through the same
// auth flow, holds the same session, and appears in the same users list as
// everyone else. A parallel collection would mean two ways to be authenticated
// and two places a deactivation has to land.
//
// NO PASSWORD IS EVER CHOSEN FOR, OR SHOWN TO, AN ADMIN. Creating a staff
// account sets an unguessable random password nobody knows, then emails the
// invitee a single-use link to set their own. So an invite email is never a
// credential in someone's inbox that also works for the person who sent it, and
// the API response never contains a password to be screenshotted into a chat.

// Invite links last a week — long enough for a new hire starting on Monday,
// where the 15-minute password-reset window would be useless. It is the same
// single-use token machinery as a password reset (the model's
// passwordResetTokenHash/Expires fields), with a TTL that suits onboarding.
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Only the SHA-256 hash of a token is ever stored, so a database leak cannot be
// used to claim an invite. Deliberately duplicated from auth.service.js rather
// than imported: it is one line, and importing would couple staff management to
// the auth service purely to share a hash call.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function getAppUrl() {
  return (process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
}

// Roles a staff account may hold. SUPER_ADMIN is included — a super admin may
// appoint another super admin, which is how the role survives one person leaving.
const ASSIGNABLE_ROLES = STAFF_ROLES;

// Roles that may NOT be converted into a staff account. Both own scoped records
// (restaurants, delivery assignments, earnings) whose ownership checks assume the
// role, and both have a conflict of interest in moderating the platform they sell
// on. Converting one would leave those records owned by an account that no longer
// has the role the ownership check expects — so it is refused outright rather
// than half-handled.
const NON_CONVERTIBLE_ROLES = Object.freeze([ROLES.RESTAURANT_OWNER, ROLES.DELIVERY_PARTNER]);

function serializeStaff(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    phone: user.phone || '',
    role: user.role,
    permissions: getPermissions(user.role),
    isActive: user.isActive,
    avatar: user.avatar || '',
    lastPasswordChangeAt: user.passwordChangedAt || null,
    // Whether this person has ever set a password of their own. A brand-new
    // invite has not, so the console can show "invite pending" rather than
    // implying an active account that simply never logs in.
    hasAcceptedInvite: Boolean(user.passwordChangedAt),
    createdAt: user.createdAt,
  };
}

// The role -> permission table, for the console to render. Served from
// permissions.js rather than duplicated in the UI, so the matrix an operator
// reads is by construction the matrix the API enforces.
function getRoleMatrix() {
  return {
    permissions: Object.values(PERMISSIONS),
    roles: ASSIGNABLE_ROLES.map((role) => ({
      role,
      permissions: ROLE_PERMISSIONS[role] || [],
    })),
  };
}

async function listStaff(query) {
  const { page, limit, skip } = parsePagination(query);

  // Always scoped to staff roles: this endpoint is the team list, not a second
  // way to enumerate customers (GET /admin/users already does that, behind its
  // own users:read permission).
  const filter = { role: { $in: ASSIGNABLE_ROLES } };

  if (query.role) {
    if (!ASSIGNABLE_ROLES.includes(query.role)) {
      throw ApiError.badRequest(`role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
    }
    filter.role = query.role;
  }
  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: re }, { email: re }];
  }

  const [items, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  return { items: items.map(serializeStaff), pagination: buildPaginationMeta(total, page, limit) };
}

// ---------------------------------------------------------------------------
// Lockout guards
//
// The platform must never reach a state where nobody can administer it. Three
// separate rules, each blocking a different way to get there.
// ---------------------------------------------------------------------------

function assertNotSelf(target, actor, action) {
  if (actor && target._id.toString() === actor._id.toString()) {
    throw ApiError.badRequest(`You cannot ${action} your own account`);
  }
}

async function countActiveSuperAdmins(excludeId) {
  const filter = { role: ROLES.SUPER_ADMIN, isActive: true };
  if (excludeId) filter._id = { $ne: excludeId };
  return User.countDocuments(filter);
}

// Blocks the change that would leave zero people able to reach settings:manage
// and admins:manage. Called BEFORE the write.
//
// CONCURRENCY: two simultaneous demotions of two different super admins, when
// exactly two exist, would each see one remaining and both pass. That window is
// closed after the write by assertSuperAdminSurvived, which re-counts and rolls
// back — a check-then-verify rather than a single atomic operation, because
// "at least one document matching a filter still exists" is not something a
// single MongoDB update can assert. The rollback is what makes it safe; the
// pre-check is what makes the common case a clean 400 instead of a write and
// an undo.
async function assertNotLastSuperAdmin(target, changeDescription) {
  if (target.role !== ROLES.SUPER_ADMIN || !target.isActive) return;
  const others = await countActiveSuperAdmins(target._id);
  if (others === 0) {
    throw ApiError.badRequest(
      `${target.name} is the only active super admin — ${changeDescription} would leave the platform with nobody who can manage settings or staff. Appoint another super admin first.`
    );
  }
}

// Post-write safety net for the race described above. Reverts the document and
// throws, so the loser of the race gets the same 400 they would have got had the
// two requests arrived in sequence.
async function assertSuperAdminSurvived(target, previous) {
  const remaining = await countActiveSuperAdmins();
  if (remaining > 0) return;
  Object.assign(target, previous);
  await target.save();
  throw ApiError.conflict(
    'Another super admin was demoted or deactivated at the same moment, and completing this change would have left none. Your change was rolled back — reload and try again.'
  );
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function createStaff({ name, email, phone, role }, actor, req) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw ApiError.badRequest(`role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
  }

  const existing = await User.findOne({ email });
  if (existing) {
    // Deliberately explicit: unlike self-registration, where revealing that an
    // email exists would leak who has an account, the caller here is already a
    // super admin who can list every user anyway. Telling them to promote the
    // existing account instead is the useful answer.
    throw ApiError.conflict(
      `${email} already has a FoodRush account (${existing.role}). Change that account's role instead of creating a second one.`
    );
  }

  // A password nobody knows, replaced by the invitee through the emailed link.
  // 48 hex characters, far past the model's 8-character minimum.
  const unguessable = crypto.randomBytes(24).toString('hex');
  const token = crypto.randomBytes(32).toString('hex');

  const user = await User.create({
    name,
    email,
    phone,
    role,
    password: unguessable, // hashed by the model's pre-save hook
    passwordResetTokenHash: hashToken(token),
    passwordResetExpires: new Date(Date.now() + INVITE_TTL_MS),
    passwordResetRequestedAt: new Date(),
  });

  // Reuses the existing reset-password screen: the invitee sets a password with
  // the same single-use, atomically-claimed flow as a forgotten one, so there is
  // no second credential path to get wrong.
  const inviteUrl = `${getAppUrl()}/reset-password?token=${token}`;
  const message = emailService.staffInviteEmail({
    name: user.name,
    role: user.role,
    inviteUrl,
    expiresInDays: INVITE_TTL_MS / (24 * 60 * 60 * 1000),
    invitedBy: actor ? actor.name : 'a FoodRush administrator',
  });
  // Not awaited, like every other transactional email in this codebase: a mail
  // outage must not fail the account creation. Message only in the log — never
  // the token or the link.
  emailService.sendMail({ to: user.email, ...message }).catch((err) => {
    console.error('Staff invite email failed:', err.message);
  });

  await auditService.record({
    req,
    actor,
    action: 'staff.create',
    entityType: 'User',
    entityId: user._id,
    metadata: { email: user.email, role: user.role },
  });

  return serializeStaff(user);
}

async function updateStaffRole(id, role, actor, req) {
  if (!ASSIGNABLE_ROLES.includes(role)) {
    throw ApiError.badRequest(`role must be one of: ${ASSIGNABLE_ROLES.join(', ')}`);
  }

  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');

  // A super admin changing their own role is the single easiest way to lock the
  // platform out, and there is no legitimate need for it — another super admin
  // can do it for them.
  assertNotSelf(user, actor, 'change the role of');

  if (NON_CONVERTIBLE_ROLES.includes(user.role)) {
    throw ApiError.badRequest(
      `${user.name} is a ${user.role} and owns records scoped to that role, so the account cannot be converted to staff. Create a separate staff account for them instead.`
    );
  }

  if (user.role === role) return serializeStaff(user); // no-op, no audit line

  await assertNotLastSuperAdmin(user, `changing their role to ${role}`);

  const previous = { role: user.role };
  user.role = role;
  await user.save();
  if (previous.role === ROLES.SUPER_ADMIN) await assertSuperAdminSurvived(user, previous);

  await auditService.record({
    req,
    actor,
    action: 'staff.role_change',
    entityType: 'User',
    entityId: user._id,
    metadata: { email: user.email, from: previous.role, to: role },
  });

  return serializeStaff(user);
}

// Removing someone from the team without deleting their account: the role drops
// to CUSTOMER, so every staff permission goes with it, but their order history
// and any support tickets they raised as a person stay intact. Deletion is not
// offered — a staff account is referenced by audit entries, moderation records
// and settlement approvals, and deleting it would orphan that history.
async function revokeStaff(id, actor, req) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');

  assertNotSelf(user, actor, 'revoke staff access from');

  if (!isStaffRole(user.role)) {
    throw ApiError.badRequest(`${user.name} is not a staff member (role is ${user.role})`);
  }

  await assertNotLastSuperAdmin(user, 'revoking their staff access');

  const previous = { role: user.role };
  user.role = ROLES.CUSTOMER;
  await user.save();
  if (previous.role === ROLES.SUPER_ADMIN) await assertSuperAdminSurvived(user, previous);

  await auditService.record({
    req,
    actor,
    action: 'staff.revoke',
    entityType: 'User',
    entityId: user._id,
    metadata: { email: user.email, from: previous.role },
  });

  return serializeStaff(user);
}

// Re-sends an invite (or sends a fresh set-password link to someone locked out).
// Issues a NEW token, which invalidates the previous one because only one hash is
// stored per user — a forwarded or leaked old link stops working the moment a new
// one is issued.
async function resendInvite(id, actor, req) {
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  if (!isStaffRole(user.role)) {
    throw ApiError.badRequest(`${user.name} is not a staff member (role is ${user.role})`);
  }
  if (!user.isActive) {
    throw ApiError.badRequest(`${user.name}'s account is deactivated — reactivate it before sending a new invite`);
  }

  const token = crypto.randomBytes(32).toString('hex');
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: hashToken(token),
        passwordResetExpires: new Date(Date.now() + INVITE_TTL_MS),
        passwordResetRequestedAt: new Date(),
      },
    }
  );

  const inviteUrl = `${getAppUrl()}/reset-password?token=${token}`;
  const message = emailService.staffInviteEmail({
    name: user.name,
    role: user.role,
    inviteUrl,
    expiresInDays: INVITE_TTL_MS / (24 * 60 * 60 * 1000),
    invitedBy: actor ? actor.name : 'a FoodRush administrator',
  });
  emailService.sendMail({ to: user.email, ...message }).catch((err) => {
    console.error('Staff invite email failed:', err.message);
  });

  await auditService.record({
    req,
    actor,
    action: 'staff.invite_resend',
    entityType: 'User',
    entityId: user._id,
    metadata: { email: user.email, role: user.role },
  });

  return serializeStaff(user);
}

module.exports = {
  ASSIGNABLE_ROLES,
  NON_CONVERTIBLE_ROLES,
  INVITE_TTL_MS,
  serializeStaff,
  getRoleMatrix,
  listStaff,
  createStaff,
  updateStaffRole,
  revokeStaff,
  resendInvite,
  // Exported for admin.service.js#setUserActive, which must apply the same
  // last-super-admin rule when it deactivates an account.
  assertNotLastSuperAdmin,
  assertSuperAdminSurvived,
  countActiveSuperAdmins,
};
