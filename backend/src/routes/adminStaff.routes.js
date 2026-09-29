const express = require('express');
const staffController = require('../controllers/staff.controller');
const validate = require('../middleware/validate');
const { authenticateUser, requirePermission } = require('../middleware/auth.middleware');
const { PERMISSIONS } = require('../utils/permissions');
const { createStaffValidator, updateStaffRoleValidator } = require('../validators/staff.validator');

// M17 — the super-admin console, mounted as a second router on /admin (see the
// note in adminSettings.routes.js). Every route requires admins:manage, which
// only SUPER_ADMIN holds, so an ADMIN cannot appoint staff or escalate itself.

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /admin/roles:
 *   get:
 *     summary: The role and permission matrix (SUPER_ADMIN only)
 *     description: >
 *       M17 — every staff role and the exact permissions it carries, served from the
 *       same table the API enforces (utils/permissions.js) rather than restated in
 *       the UI, so what an operator reads before assigning a role is by construction
 *       what that role will be able to do.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: The full permission list, and each assignable staff role with its permissions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     permissions:
 *                       type: array
 *                       items: { type: string }
 *                       example: ['dashboard:view', 'users:read', 'settings:manage']
 *                     roles:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           role: { type: string, example: SUPPORT_AGENT }
 *                           permissions: { type: array, items: { type: string } }
 */
router.get('/roles', requirePermission(PERMISSIONS.ADMINS_MANAGE), staffController.getRoleMatrix);

/**
 * @swagger
 * /admin/staff:
 *   get:
 *     summary: List staff accounts (SUPER_ADMIN only)
 *     description: >
 *       Always scoped to staff roles — this is the team list, not a second way to
 *       enumerate customers (GET /admin/users does that, behind users:read).
 *       `hasAcceptedInvite` is false until the person has set a password of their
 *       own, so a pending invite is distinguishable from an account that simply
 *       never signs in.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string }
 *         description: Filter to one staff role. A non-staff role is a 400, not an empty list.
 *       - in: query
 *         name: isActive
 *         schema: { type: string, enum: ['true', 'false'] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Case-insensitive match on name or email
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1 }
 *     responses:
 *       200:
 *         description: Staff accounts, each with the permissions its role carries
 */
router.get('/staff', requirePermission(PERMISSIONS.ADMINS_MANAGE), staffController.listStaff);

/**
 * @swagger
 * /admin/staff:
 *   post:
 *     summary: Create a staff account and email an invite (SUPER_ADMIN only)
 *     description: >
 *       M17 — creates an ordinary User with a staff role, sets a random password
 *       nobody knows, and emails the person a single-use link to set their own.
 *
 *       No password is accepted in the request or returned in the response, by
 *       design: an admin never holds another person's credentials, and there is
 *       nothing here to paste into a chat. The invite link lasts 7 days (long
 *       enough for a new hire starting next week, unlike the 15-minute
 *       password-reset window) and reuses the same single-use, atomically-claimed
 *       reset flow, so there is no second credential path to get wrong.
 *
 *       If the email already belongs to an account, this is a 409 naming that
 *       account's role — change its role instead of creating a duplicate. Unlike
 *       self-registration, saying so leaks nothing: the caller is a super admin who
 *       can already list every user.
 *
 *       Writes an M11 audit entry (`staff.create`).
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, role]
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *               email: { type: string, format: email }
 *               phone: { type: string, maxLength: 20 }
 *               role:
 *                 type: string
 *                 enum: [SUPER_ADMIN, ADMIN, OPERATIONS_MANAGER, RESTAURANT_MANAGER, DELIVERY_MANAGER, SUPPORT_AGENT]
 *                 description: A super admin may appoint another super admin — that is how the role survives one person leaving.
 *     responses:
 *       201:
 *         description: Account created, invite sent. Contains no credential.
 *       409:
 *         description: That email already has an account
 *       422:
 *         description: Missing or malformed field, or a role that is not a staff role
 */
router.post('/staff', requirePermission(PERMISSIONS.ADMINS_MANAGE), createStaffValidator, validate, staffController.createStaff);

/**
 * @swagger
 * /admin/staff/{id}/role:
 *   patch:
 *     summary: Change a staff member's role (SUPER_ADMIN only)
 *     description: >
 *       Three guards, each blocking a different route to locking the platform out:
 *       you cannot change your OWN role (another super admin must do it for you);
 *       you cannot demote the last active SUPER_ADMIN; and a RESTAURANT_OWNER or
 *       DELIVERY_PARTNER cannot be converted to staff at all, because both own
 *       records whose ownership checks assume the role, and both have a conflict of
 *       interest in moderating the platform they sell on.
 *
 *       A CUSTOMER may be promoted to staff. Setting the role it already has is a
 *       successful no-op with no audit entry.
 *
 *       Writes an M11 audit entry (`staff.role_change`) recording the old and new role.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role]
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [SUPER_ADMIN, ADMIN, OPERATIONS_MANAGER, RESTAURANT_MANAGER, DELIVERY_MANAGER, SUPPORT_AGENT]
 *     responses:
 *       200:
 *         description: The updated staff account
 *       400:
 *         description: Changing your own role, demoting the last super admin, or converting a restaurant owner / delivery partner
 *       404:
 *         description: No such user
 */
router.patch(
  '/staff/:id/role',
  requirePermission(PERMISSIONS.ADMINS_MANAGE),
  updateStaffRoleValidator,
  validate,
  staffController.updateStaffRole
);

/**
 * @swagger
 * /admin/staff/{id}/revoke:
 *   patch:
 *     summary: Remove someone from the team (SUPER_ADMIN only)
 *     description: >
 *       Drops the role to CUSTOMER, so every staff permission goes with it while the
 *       person's own order history survives. Deletion is deliberately not offered:
 *       a staff account is referenced by audit entries, moderation decisions and
 *       settlement approvals, and deleting it would orphan that history.
 *
 *       Subject to the same self-change and last-super-admin guards as a role change.
 *
 *       Writes an M11 audit entry (`staff.revoke`).
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The account, now a CUSTOMER
 *       400:
 *         description: Revoking your own access, revoking the last super admin, or the user is not staff
 *       404:
 *         description: No such user
 */
router.patch('/staff/:id/revoke', requirePermission(PERMISSIONS.ADMINS_MANAGE), staffController.revokeStaff);

/**
 * @swagger
 * /admin/staff/{id}/resend-invite:
 *   post:
 *     summary: Re-send a staff invite / set-password link (SUPER_ADMIN only)
 *     description: >
 *       For an invite that expired or never arrived, or someone locked out of their
 *       account. Issues a NEW token, which invalidates the previous one because only
 *       one token hash is stored per user — a forwarded or leaked old link stops
 *       working the moment a new one is issued.
 *
 *       Refused for a deactivated account: reactivate it first, so a disabled
 *       account can never be handed a working way back in.
 *
 *       Writes an M11 audit entry (`staff.invite_resend`).
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: A fresh invite was sent
 *       400:
 *         description: The user is not staff, or their account is deactivated
 *       404:
 *         description: No such user
 */
router.post('/staff/:id/resend-invite', requirePermission(PERMISSIONS.ADMINS_MANAGE), staffController.resendInvite);

module.exports = router;
