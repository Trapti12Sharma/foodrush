const { body } = require('express-validator');
const { ROLES } = require('../utils/constants');

// Public self-registration is intentionally limited to CUSTOMER/RESTAURANT_OWNER —
// ADMIN accounts are never creatable through this endpoint (see seed script, Phase 23,
// or direct DB provisioning).
const registerValidator = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).trim(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('role')
    .optional()
    .isIn([ROLES.CUSTOMER, ROLES.RESTAURANT_OWNER])
    .withMessage('Role must be CUSTOMER or RESTAURANT_OWNER'),
];

const loginValidator = [
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
];

module.exports = { registerValidator, loginValidator };
