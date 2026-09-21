// One-time, opt-in provisioning of the real SUPER_ADMIN account.
//
//   SUPER_ADMIN_EMAIL=you@yourdomain.com node scripts/bootstrap-super-admin.js          # dry run
//   SUPER_ADMIN_EMAIL=... SUPER_ADMIN_PASSWORD=... node scripts/bootstrap-super-admin.js --apply
//
// - DRY RUN BY DEFAULT: prints what it would do and changes nothing until --apply.
// - Touches exactly one user document (matched by that email). It never deletes
//   anything, never drops a collection, and never modifies any other user.
// - If the user exists it only promotes the role (the password is left as-is); the
//   password is required only when the account has to be created.
// - The password is read from the environment, is never printed, and must be 12+ chars.
// - Records an audit-log entry so the promotion is traceable.
require('dotenv').config();
const mongoose = require('mongoose');

const { User } = require('../src/models');
const AuditLog = require('../src/models/AuditLog');
const { ROLES } = require('../src/utils/constants');

const MIN_PASSWORD_LENGTH = 12;

// Exported (and free of process.exit) so the logic is testable without a CLI.
async function bootstrapSuperAdmin({ email, password, apply = false, log = () => {} }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw new Error('SUPER_ADMIN_EMAIL must be set to a valid email address.');
  }
  if (normalizedEmail.endsWith('@example.com')) {
    log('Warning: @example.com is the public demo domain — use a real address you control.');
  }

  const existing = await User.findOne({ email: normalizedEmail });

  if (existing) {
    if (existing.role === ROLES.SUPER_ADMIN) {
      log(`${normalizedEmail} is already a SUPER_ADMIN — nothing to do.`);
      return { action: 'none', applied: false };
    }
    log(`${apply ? 'Promoting' : 'Would promote'} existing user ${normalizedEmail}: ${existing.role} -> SUPER_ADMIN (password unchanged).`);
    if (apply) {
      const previousRole = existing.role;
      existing.role = ROLES.SUPER_ADMIN;
      existing.isActive = true;
      await existing.save();
      await AuditLog.create({
        actor: null,
        actorRole: null,
        action: 'super_admin.bootstrap',
        entityType: 'User',
        entityId: existing._id,
        metadata: { mode: 'promote', previousRole },
      });
    }
    return { action: 'promote', applied: apply };
  }

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`No user with that email exists, so SUPER_ADMIN_PASSWORD is required (at least ${MIN_PASSWORD_LENGTH} characters).`);
  }
  log(`${apply ? 'Creating' : 'Would create'} new SUPER_ADMIN account ${normalizedEmail}.`);
  if (apply) {
    const user = await User.create({ name: 'Super Admin', email: normalizedEmail, password, role: ROLES.SUPER_ADMIN });
    await AuditLog.create({
      actor: null,
      actorRole: null,
      action: 'super_admin.bootstrap',
      entityType: 'User',
      entityId: user._id,
      metadata: { mode: 'create' },
    });
  }
  return { action: 'create', applied: apply };
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');

  await mongoose.connect(process.env.MONGODB_URI);
  // Names the target database (never the credentials) so you can confirm you are pointed at the right one.
  console.log(`Connected to database "${mongoose.connection.name}". Mode: ${apply ? 'APPLY' : 'DRY RUN (no changes)'}`);

  const result = await bootstrapSuperAdmin({
    email: process.env.SUPER_ADMIN_EMAIL,
    password: process.env.SUPER_ADMIN_PASSWORD,
    apply,
    log: (line) => console.log(line),
  });
  if (!apply && result.action !== 'none') console.log('\nNothing was changed. Re-run with --apply to make the change.');

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`Bootstrap failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { bootstrapSuperAdmin };
