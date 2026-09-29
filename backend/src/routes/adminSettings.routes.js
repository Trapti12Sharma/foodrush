const express = require('express');
const platformSettingController = require('../controllers/platformSetting.controller');
const validate = require('../middleware/validate');
const { authenticateUser, requirePermission } = require('../middleware/auth.middleware');
const { PERMISSIONS } = require('../utils/permissions');
const { updateSettingsValidator } = require('../validators/platformSetting.validator');

// M17 — mounted on /admin as a SECOND router alongside admin.routes.js, the same
// way deliveryEarning.routes.js shares the /delivery-partners prefix with
// deliveryPartner.routes.js. Platform settings are their own concern with their
// own permission, and admin.routes.js is already the largest file in the project.
//
// settings:manage is held by SUPER_ADMIN alone (permissions.js). An ADMIN can run
// the marketplace day to day but cannot change what customers are taxed or what
// riders are paid — that separation is the reason the two roles exist.

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /admin/settings:
 *   get:
 *     summary: Read the platform settings (SUPER_ADMIN only)
 *     description: >
 *       M17 — the admin-editable money rules: the tax rate applied to every order
 *       total, and the base/per-km/floor/cap rates plus incentive rules that decide
 *       what a delivery partner earns. The singleton document is created with
 *       platform defaults the first time it is read, so this never 404s.
 *
 *       `version` in the response must be sent back on the next PATCH — it is the
 *       optimistic-concurrency token that stops two super admins silently
 *       overwriting each other.
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: The current platform settings
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     settings:
 *                       $ref: '#/components/schemas/PlatformSetting'
 *       403:
 *         description: Caller lacks settings:manage (every role except SUPER_ADMIN)
 */
router.get('/settings', requirePermission(PERMISSIONS.SETTINGS_MANAGE), platformSettingController.getSettings);

/**
 * @swagger
 * /admin/settings:
 *   patch:
 *     summary: Update the platform settings (SUPER_ADMIN only)
 *     description: >
 *       Partial update — only the fields present in the body are changed, so a
 *       request carrying one rate cannot reset the others. Fields outside the
 *       editable allow-list (`key`, `version`, `updatedBy`, timestamps) are ignored
 *       rather than applied.
 *
 *       `version` is REQUIRED and must equal the version last read, otherwise the
 *       request is rejected with 409 and nothing is written. A request that changes
 *       nothing is a successful no-op: it does not bump the version and writes no
 *       audit entry, so pressing Save twice does not invalidate a colleague's open
 *       form.
 *
 *       Editing a rate never re-prices anything that already happened — orders and
 *       rider earnings snapshot their own amounts when they are created.
 *
 *       Every save that changes at least one field writes an M11 audit entry
 *       (`settings.update`) listing each field that moved, with its old and new value.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [version]
 *             properties:
 *               version:
 *                 type: integer
 *                 minimum: 1
 *                 description: The version you read. A mismatch is a 409.
 *               pricing:
 *                 type: object
 *                 properties:
 *                   taxRate:
 *                     type: number
 *                     minimum: 0
 *                     maximum: 0.5
 *                     description: Fraction, not a percentage — 0.05 is 5%. Capped at 0.5 so a mistyped percentage cannot overcharge every customer at once.
 *               delivery:
 *                 type: object
 *                 properties:
 *                   baseEarning: { type: number, minimum: 0, maximum: 10000, description: 'Flat amount a rider earns per completed delivery (INR)' }
 *                   perKmRate: { type: number, minimum: 0, maximum: 1000, description: 'Paid per km of the order''s server-computed delivery distance; contributes nothing when that distance is unknown' }
 *                   minEarning: { type: number, minimum: 0, maximum: 10000, description: 'Floor applied after the incentives are added' }
 *                   maxEarning:
 *                     type: number
 *                     nullable: true
 *                     minimum: 0
 *                     maximum: 100000
 *                     description: Ceiling applied last. Send null to remove the cap; 0 is a real (if cruel) cap of zero and is not the same thing.
 *                   incentives:
 *                     type: object
 *                     properties:
 *                       longDistance:
 *                         type: object
 *                         properties:
 *                           enabled: { type: boolean }
 *                           thresholdKm: { type: number, minimum: 0, maximum: 500 }
 *                           bonusAmount: { type: number, minimum: 0, maximum: 10000 }
 *                       peakHour:
 *                         type: object
 *                         properties:
 *                           enabled: { type: boolean }
 *                           bonusAmount: { type: number, minimum: 0, maximum: 10000 }
 *                           windows:
 *                             type: array
 *                             maxItems: 8
 *                             description: >
 *                               Replaced wholesale, not patched per index. Hours are UTC and
 *                               half-open — [startHour, endHour). A window may wrap past
 *                               midnight (22 to 2 means 22:00-01:59), which is the late-night
 *                               peak. startHour equal to endHour is rejected.
 *                             items:
 *                               type: object
 *                               required: [startHour, endHour]
 *                               properties:
 *                                 startHour: { type: integer, minimum: 0, maximum: 23 }
 *                                 endHour: { type: integer, minimum: 0, maximum: 23 }
 *           examples:
 *             raiseTax:
 *               summary: Raise the tax rate to 8%
 *               value: { version: 3, pricing: { taxRate: 0.08 } }
 *             lateNightBonus:
 *               summary: Pay riders an extra 30 for late-night deliveries
 *               value:
 *                 version: 3
 *                 delivery:
 *                   incentives:
 *                     peakHour:
 *                       enabled: true
 *                       bonusAmount: 30
 *                       windows: [{ startHour: 17, endHour: 21 }, { startHour: 22, endHour: 2 }]
 *             removeCap:
 *               summary: Remove the per-delivery earnings cap
 *               value: { version: 3, delivery: { maxEarning: null } }
 *     responses:
 *       200:
 *         description: The updated settings, with a bumped version (unchanged if the request was a no-op)
 *       400:
 *         description: A cross-field invariant failed — minEarning above maxEarning, or the peak-hour incentive enabled with no windows
 *       409:
 *         description: Someone else changed the settings since you read them; reload and reapply
 *       422:
 *         description: A field is missing, the wrong type, or outside its allowed range
 */
router.patch(
  '/settings',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  updateSettingsValidator,
  validate,
  platformSettingController.updateSettings
);

module.exports = router;
