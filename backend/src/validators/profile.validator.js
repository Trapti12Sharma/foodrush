const { body } = require('express-validator');

// bcrypt only uses the first 72 bytes of a password, so anything longer would be
// silently truncated — reject it instead of pretending it was all used.
const MAX_PASSWORD_LENGTH = 72;

// Accepts a locally uploaded file ("/uploads/<name>") or an https:// image URL.
// Anything else — notably javascript:, data: or http: — is rejected.
function isSafeAvatar(value) {
  if (value === '' || value === null) return true; // clears the avatar
  if (typeof value !== 'string' || value.length > 500) return false;
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(value)) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

const updateProfileValidator = [
  body('name').optional().trim().notEmpty().withMessage('Name cannot be empty').isLength({ max: 100 }),
  body('phone')
    .optional({ nullable: true })
    .trim()
    .custom((v) => v === '' || /^\+?[0-9][0-9\s-]{6,14}$/.test(v))
    .withMessage('Enter a valid phone number'),
  body('email').optional().trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('avatar').optional({ nullable: true }).custom(isSafeAvatar).withMessage('Avatar must be an uploaded image or an https:// URL'),
  body('currentPassword').optional().isString(),
];

const changePasswordValidator = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8, max: MAX_PASSWORD_LENGTH })
    .withMessage(`New password must be 8–${MAX_PASSWORD_LENGTH} characters`),
];

const forgotPasswordValidator = [body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail()];

const resetPasswordValidator = [
  body('token')
    .isString()
    .matches(/^[a-f0-9]{64}$/)
    .withMessage('Invalid or expired reset link'),
  body('password')
    .isLength({ min: 8, max: MAX_PASSWORD_LENGTH })
    .withMessage(`Password must be 8–${MAX_PASSWORD_LENGTH} characters`),
];

module.exports = {
  updateProfileValidator,
  changePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  isSafeAvatar,
  MAX_PASSWORD_LENGTH,
};
