const express = require('express');
const controller = require('../controllers/notification.controller');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /notifications/unread-count:
 *   get:
 *     summary: Your unread notification count
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: Count
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { count: { type: integer } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
// Registered before GET /:id — otherwise Express would try to treat
// "unread-count" as an :id value (both are a single path segment).
router.get('/unread-count', controller.getUnreadCount);

/**
 * @swagger
 * /notifications/read-all:
 *   post:
 *     summary: Mark every one of your unread notifications as read
 *     tags: [Notifications]
 *     responses:
 *       200:
 *         description: How many were updated
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { modifiedCount: { type: integer } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/read-all', controller.markAllAsRead);

/**
 * @swagger
 * /notifications:
 *   get:
 *     summary: List your own notifications, newest first
 *     tags: [Notifications]
 *     parameters:
 *       - { in: query, name: unread, schema: { type: string, enum: ['true'] }, description: 'Pass unread=true to see only unread notifications' }
 *       - { in: query, name: type, schema: { type: string }, description: 'Filter by notification type' }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200:
 *         description: A page of your notifications
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     notifications: { type: array, items: { $ref: '#/components/schemas/Notification' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', controller.listMyNotifications);

/**
 * @swagger
 * /notifications/{id}:
 *   get:
 *     summary: Get one of your own notifications
 *     description: 404 (never 403) if it does not belong to you — never confirms whether a notification with that id exists at all.
 *     tags: [Notifications]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Notification detail }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', controller.getMyNotification);

/**
 * @swagger
 * /notifications/{id}/read:
 *   post:
 *     summary: Mark one of your own notifications as read
 *     description: Idempotent — marking an already-read notification again just returns it unchanged, rather than erroring.
 *     tags: [Notifications]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Marked read }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:id/read', controller.markAsRead);

module.exports = router;
