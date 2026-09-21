const crypto = require('crypto');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');
const emailService = require('./email.service');
const { getAppUrl } = require('../config/cors');

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;
const PROFILE_FIELDS = ['name', 'phone', 'avatar'];

// Only the hash of a reset token is ever stored or compared.
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function registerUser({ name, email, phone, password, role }) {
  const existing = await User.findOne({ email });
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: role || ROLES.CUSTOMER,
  });

  return user;
}

async function loginUser({ email, password }) {
  const user = await User.findOne({ email }).select('+password');

  // Same generic message whether the email doesn't exist or the password is
  // wrong — avoids leaking which accounts are registered.
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been disabled');
  }

  return user;
}

// Whitelisted fields only — role, isActive and everything else can never be set
// through this path. Changing the email is a sensitive action, so it re-checks the
// current password. (A wrong password is a 400, not a 401: the frontend treats any
// 401 as "session expired" and would log the user out.)
async function updateProfile(userId, { currentPassword, email, ...fields }) {
  const user = await User.findById(userId).select('+password');
  if (!user) throw ApiError.notFound('User not found');

  let emailChanged = false;
  if (email !== undefined && email !== user.email) {
    if (!currentPassword || !(await user.comparePassword(currentPassword))) {
      throw ApiError.badRequest('Enter your current password to change your email');
    }
    if (await User.findOne({ email })) throw ApiError.conflict('An account with this email already exists');
    user.email = email;
    emailChanged = true;
  }

  PROFILE_FIELDS.forEach((field) => {
    if (fields[field] !== undefined) user[field] = fields[field];
  });

  await user.save();
  return { user, emailChanged };
}

async function changePassword(userId, { currentPassword, newPassword }) {
  const user = await User.findById(userId).select('+password');
  if (!user) throw ApiError.notFound('User not found');

  if (!(await user.comparePassword(currentPassword))) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  if (currentPassword === newPassword) {
    throw ApiError.badRequest('Choose a new password that is different from the current one');
  }

  user.password = newPassword; // hashed by the model's pre-save hook
  user.passwordChangedAt = new Date(); // signs out every older session
  await user.save();

  notifyPasswordChanged(user);
  return user;
}

// Always behaves the same to the caller whether or not the email is registered
// (the controller returns one generic response), so this can't be used to discover
// accounts. The email itself is sent in the background — not awaited — so response
// timing doesn't reveal which branch ran either.
async function requestPasswordReset(email) {
  const user = await User.findOne({ email }).select('+passwordResetRequestedAt');
  if (!user || !user.isActive) return;

  if (user.passwordResetRequestedAt && Date.now() - user.passwordResetRequestedAt.getTime() < RESET_REQUEST_COOLDOWN_MS) {
    return; // one email per minute per account: blocks mail-bombing a victim
  }

  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  await User.updateOne(
    { _id: user._id },
    {
      $set: {
        passwordResetTokenHash: hashToken(token),
        passwordResetExpires: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        passwordResetRequestedAt: now,
      },
    }
  );

  const resetUrl = `${getAppUrl()}/reset-password?token=${token}`;
  const message = emailService.passwordResetEmail({
    name: user.name,
    resetUrl,
    expiresInMinutes: RESET_TOKEN_TTL_MS / 60000,
  });
  emailService.sendMail({ to: user.email, ...message }).catch((err) => {
    // Message only — never the token, the link or the recipient's password.
    console.error('Password reset email failed:', err.message);
  });
}

// Single-use: the token is claimed atomically (the findOneAndUpdate clears it and
// returns the user in one step), so two simultaneous requests can't both succeed.
async function resetPassword({ token, password }) {
  const claimed = await User.findOneAndUpdate(
    { passwordResetTokenHash: hashToken(token), passwordResetExpires: { $gt: new Date() } },
    { $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } },
    { new: true }
  );
  if (!claimed || !claimed.isActive) throw ApiError.badRequest('This reset link is invalid or has expired');

  const user = await User.findById(claimed._id).select('+password');
  user.password = password;
  user.passwordChangedAt = new Date();
  await user.save();

  notifyPasswordChanged(user);
  return user;
}

function notifyPasswordChanged(user) {
  emailService.sendMail({ to: user.email, ...emailService.passwordChangedEmail({ name: user.name }) }).catch((err) => {
    console.error('Password-changed notification failed:', err.message);
  });
}

module.exports = { registerUser, loginUser, updateProfile, changePassword, requestPasswordReset, resetPassword };
