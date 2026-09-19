const express = require('express');
const restaurantController = require('../controllers/restaurant.controller');
const dashboardController = require('../controllers/dashboard.controller');
const reviewController = require('../controllers/review.controller');
const { createRestaurantValidator, updateRestaurantValidator } = require('../validators/restaurant.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles, optionalAuth } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

/**
 * @swagger
 * /restaurants:
 *   get:
 *     summary: Search/browse publicly-visible restaurants (approved and active only)
 *     tags: [Restaurants]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches restaurant name or cuisine (substring, case-insensitive)
 *       - in: query
 *         name: cuisine
 *         schema: { type: string }
 *       - in: query
 *         name: city
 *         schema: { type: string }
 *       - in: query
 *         name: minRating
 *         schema: { type: number }
 *       - in: query
 *         name: maxDeliveryTime
 *         schema: { type: number }
 *       - in: query
 *         name: isOpen
 *         schema: { type: boolean }
 *       - in: query
 *         name: near
 *         schema: { type: string, example: "73.8567,18.5204" }
 *         description: "lng,lat — sorts by distance instead of the `sort` param; from the browser Geolocation API"
 *       - in: query
 *         name: maxDistanceKm
 *         schema: { type: number, default: 10 }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [rating, deliveryTime, deliveryFee, newest], default: rating }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of restaurants
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
 */
router.get('/', restaurantController.list);

/**
 * @swagger
 * /restaurants/mine:
 *   get:
 *     summary: List every restaurant the signed-in owner runs, regardless of approval/active status
 *     tags: [Restaurants]
 *     responses:
 *       200:
 *         description: The owner's own restaurants
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurants: { type: array, items: { $ref: '#/components/schemas/Restaurant' } } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/mine', authenticateUser, authorizeRoles(ROLES.RESTAURANT_OWNER), restaurantController.listMine);

/**
 * @swagger
 * /restaurants/{id}/dashboard:
 *   get:
 *     summary: Stats for one restaurant (owner of that restaurant, or admin)
 *     tags: [Restaurants]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Today's/total/pending/delivered order counts and delivered-orders revenue
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     todayOrders: { type: integer }
 *                     totalOrders: { type: integer }
 *                     pendingOrders: { type: integer }
 *                     deliveredOrders: { type: integer }
 *                     revenue: { type: number, description: 'Sum of totalAmount over DELIVERED orders only' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id/dashboard',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  dashboardController.getRestaurantDashboard
);

/**
 * @swagger
 * /restaurants/{id}/reviews:
 *   get:
 *     summary: List reviews for a restaurant
 *     tags: [Reviews]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of reviews, each with the reviewer's name/avatar populated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     reviews: { type: array, items: { $ref: '#/components/schemas/Review' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 */
router.get('/:id/reviews', reviewController.listForRestaurant);

/**
 * @swagger
 * /restaurants/{id}:
 *   get:
 *     summary: Get one restaurant by id
 *     description: Returns 404 (not 403) for a restaurant that exists but isn't approved/active, unless the requester is its owner or an admin — this never reveals whether a hidden restaurant exists.
 *     tags: [Restaurants]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The restaurant
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', optionalAuth, restaurantController.getById);

/**
 * @swagger
 * /restaurants:
 *   post:
 *     summary: Create a restaurant (RESTAURANT_OWNER only)
 *     description: Always created with isApproved=false — invisible to the public until an admin approves it.
 *     tags: [Restaurants]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, cuisine, address, city, deliveryTime]
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string, description: 'URL from POST /uploads/image' }
 *               cuisine: { type: array, items: { type: string }, minItems: 1 }
 *               address: { type: object, properties: { addressLine: { type: string }, state: { type: string }, pincode: { type: string } } }
 *               city: { type: string }
 *               deliveryTime: { type: number }
 *               deliveryFee: { type: number }
 *               minimumOrder: { type: number }
 *     responses:
 *       201:
 *         description: Created, pending admin approval
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER),
  createRestaurantValidator,
  validate,
  restaurantController.create
);

/**
 * @swagger
 * /restaurants/{id}:
 *   put:
 *     summary: Update a restaurant (its own owner, or admin)
 *     description: isApproved/isActive are never settable here — only through the admin endpoints.
 *     tags: [Restaurants]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *               cuisine: { type: array, items: { type: string } }
 *               address: { type: object }
 *               city: { type: string }
 *               deliveryTime: { type: number }
 *               deliveryFee: { type: number }
 *               minimumOrder: { type: number }
 *               isOpen: { type: boolean, description: "Owner's own open/closed-for-today toggle" }
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
router.put(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateRestaurantValidator,
  validate,
  restaurantController.update
);

/**
 * @swagger
 * /restaurants/{id}:
 *   delete:
 *     summary: Deactivate a restaurant (soft delete — its own owner, or admin)
 *     description: Sets isActive=false rather than removing the document, so existing orders/reviews referencing it stay intact.
 *     tags: [Restaurants]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deactivated }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  restaurantController.remove
);

module.exports = router;
