const { body } = require('express-validator');
const { STAFF_ROLES } = require('../utils/permissions');

// M17 — the role list comes from permissions.js rather than being restated here,
// so adding a staff role is still a one-place change (the whole point of the
// permission table) and this validator can never drift from what the service
// will accept.
//
// No password field: an admin never sets another person's password (see
// staff.service.js). There is deliberately nothing here to leave one out of.
const createStaffValidator = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('email').trim().isEmail().withMessage('A valid email is required').normalizeEmail(),
  body('phone').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('role').isIn(STAFF_ROLES).withMessage(`role must be one of: ${STAFF_ROLES.join(', ')}`),
];

const updateStaffRoleValidator = [
  body('role').isIn(STAFF_ROLES).withMessage(`role must be one of: ${STAFF_ROLES.join(', ')}`),
];

module.exports = { createStaffValidator, updateStaffRoleValidator };
