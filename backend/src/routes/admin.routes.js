const express = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticateUser, authorizeRoles(ROLES.ADMIN));

/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Platform-wide stats (ADMIN only)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Platform stats, a 7-day order-count series, and a per-status breakdown
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalUsers: { type: integer }
 *                     totalRestaurants: { type: integer }
 *                     totalOrders: { type: integer }
 *                     pendingOrders: { type: integer }
 *                     deliveredOrders: { type: integer }
 *                     revenue: { type: number, description: 'Sum of totalAmount over DELIVERED orders only' }
 *                     statusBreakdown:
 *                       type: array
 *                       items: { type: object, properties: { status: { type: string }, count: { type: integer } } }
 *                     last7Days:
 *                       type: array
 *                       items: { type: object, properties: { date: { type: string, format: date }, count: { type: integer } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/dashboard', adminController.getDashboard);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List/search users (ADMIN only)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches name or email
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [CUSTOMER, RESTAURANT_OWNER, ADMIN] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     users: { type: array, items: { $ref: '#/components/schemas/User' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/users', adminController.listUsers);

/**
 * @swagger
 * /admin/users/{id}/status:
 *   patch:
 *     summary: Enable/disable a user account (ADMIN only)
 *     description: A disabled account is rejected on login (403) and on its very next authenticated request even with a still-valid token (401) — isActive is re-checked from the DB on every request, not cached in the JWT.
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
 *           schema: { type: object, required: [isActive], properties: { isActive: { type: boolean } } }
 *     responses:
 *       200:
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { user: { $ref: '#/components/schemas/User' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch('/users/:id/status', [body('isActive').isBoolean()], validate, adminController.setUserActive);

/**
 * @swagger
 * /admin/restaurants:
 *   get:
 *     summary: List/search every restaurant, including unapproved/inactive ones (ADMIN only)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: isApproved
 *         schema: { type: boolean }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of restaurants, each with its owner's name/email populated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     restaurants: { type: array, items: { $ref: '#/components/schemas/Restaurant' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/restaurants', adminController.listRestaurants);

/**
 * @swagger
 * /admin/restaurants/{id}/approve:
 *   patch:
 *     summary: Approve a restaurant, making it publicly visible (ADMIN only)
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Approved restaurant
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/restaurants/:id/approve', adminController.approveRestaurant);

/**
 * @swagger
 * /admin/restaurants/{id}/status:
 *   patch:
 *     summary: Enable/disable a restaurant (ADMIN only)
 *     description: A disabled restaurant disappears from public search/detail immediately, but its order/review history is untouched.
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
 *           schema: { type: object, required: [isActive], properties: { isActive: { type: boolean } } }
 *     responses:
 *       200:
 *         description: Updated restaurant
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch('/restaurants/:id/status', [body('isActive').isBoolean()], validate, adminController.setRestaurantActive);

/**
 * @swagger
 * /admin/orders:
 *   get:
 *     summary: List every order platform-wide (ADMIN only)
 *     description: Reuses the same unscoped branch GET /orders already takes for an ADMIN caller, under this dedicated admin-only path.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, preparing, ready_for_pickup, out_for_delivery, delivered, cancelled, rejected] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders: { type: array, items: { $ref: '#/components/schemas/Order' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/orders', adminController.listOrders);

module.exports = router;
