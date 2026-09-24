const express = require('express');
const controller = require('../controllers/notificationPreference.controller');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');
const { updatePreferencesValidator } = require('../validators/notificationPreference.validator');

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /notification-preferences:
 *   get:
 *     summary: Get your own notification preferences
 *     description: Lazily created with defaults (all true except marketing) on first access — no separate "create" step is needed.
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Your preferences
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { preferences: { $ref: '#/components/schemas/NotificationPreference' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', controller.getMyPreferences);

/**
 * @swagger
 * /notification-preferences:
 *   put:
 *     summary: Update your own notification preferences
 *     description: Explicit whitelist only — an unknown key in the body is silently ignored, never persisted. ACCOUNT_SECURITY/SYSTEM notifications are never gated by any of these and cannot be disabled.
 *     tags: [Notifications]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               orderUpdates: { type: boolean }
 *               paymentUpdates: { type: boolean }
 *               deliveryUpdates: { type: boolean }
 *               supportUpdates: { type: boolean }
 *               marketing: { type: boolean, description: 'Disabled by default; M12 sends no marketing messages of any kind' }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.put('/', updatePreferencesValidator, validate, controller.updateMyPreferences);

module.exports = router;
