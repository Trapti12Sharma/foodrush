const express = require('express');
const restaurantController = require('../controllers/restaurant.controller');
const restaurantGeoController = require('../controllers/restaurantGeo.controller');
const { nearbyValidator, deliveryCheckValidator } = require('../validators/restaurantGeo.validator');
const dashboardController = require('../controllers/dashboard.controller');
const reviewController = require('../controllers/review.controller');
const { createRestaurantValidator, updateRestaurantValidator } = require('../validators/restaurant.validator');
const validate = require('../middleware/validate');
const {
  authenticateUser,
  authorizeRoles,
  requireOwnerOrPermission,
  optionalAuth,
} = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');
const { PERMISSIONS } = require('../utils/permissions');

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
 * /restaurants/nearby:
 *   get:
 *     summary: Restaurants around a point, with real distance, ETA estimate and menu-derived flags
 *     description: >
 *       Public. Uses a geospatial query, so only restaurants that have coordinates can appear. By default only
 *       restaurants that actually deliver to the point (distance within their own delivery radius) are returned;
 *       pass `includeOutOfRange=true` to include the rest, flagged `deliverable: false`.
 *       `estimatedDeliveryMinutes` is an estimate (restaurant time + ~3 min per km), not live routing.
 *       `hasOffer`, `isPureVeg`, `servesNonVeg` and `avgPrice` are derived from the restaurant's available menu.
 *     tags: [Restaurants]
 *     security: []
 *     parameters:
 *       - { in: query, name: lat, required: true, schema: { type: number } }
 *       - { in: query, name: lng, required: true, schema: { type: number } }
 *       - { in: query, name: radius, schema: { type: number, default: 10, maximum: 50 }, description: Search radius in km }
 *       - { in: query, name: search, schema: { type: string } }
 *       - { in: query, name: cuisine, schema: { type: string } }
 *       - { in: query, name: minRating, schema: { type: number } }
 *       - { in: query, name: maxDeliveryTime, schema: { type: integer }, description: Max estimated minutes }
 *       - { in: query, name: maxPrice, schema: { type: number }, description: Max typical item price }
 *       - { in: query, name: veg, schema: { type: boolean }, description: Pure-veg restaurants only }
 *       - { in: query, name: nonVeg, schema: { type: boolean }, description: Restaurants that serve non-veg }
 *       - { in: query, name: hasOffer, schema: { type: boolean } }
 *       - { in: query, name: openNow, schema: { type: boolean } }
 *       - { in: query, name: includeOutOfRange, schema: { type: boolean } }
 *       - { in: query, name: sort, schema: { type: string, enum: [recommended, distance, rating, deliveryTime, deliveryFee, price], default: recommended } }
 *       - { in: query, name: page, schema: { type: integer } }
 *       - { in: query, name: limit, schema: { type: integer } }
 *     responses:
 *       200: { description: 'Page of restaurants with distanceKm, estimatedDeliveryMinutes, deliverable, hasOffer, isPureVeg, servesNonVeg and avgPrice' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/nearby', nearbyValidator, validate, restaurantGeoController.nearby);

/**
 * @swagger
 * /restaurants/cities:
 *   get:
 *     summary: Cities that currently have live restaurants (with an average position)
 *     description: Powers the "popular cities" location picker; works without any Google key.
 *     tags: [Restaurants]
 *     security: []
 *     responses:
 *       200: { description: "cities: [{city, restaurantCount, latitude, longitude}] — coordinates are null if no restaurant there has a location" }
 */
router.get('/cities', restaurantGeoController.cities);

/**
 * @swagger
 * /restaurants/{id}/delivery-check:
 *   post:
 *     summary: Does this restaurant deliver to a point?
 *     description: >
 *       Returns `deliverable` (true/false, or null when the restaurant has no location and it cannot be measured),
 *       the distance and the restaurant's delivery radius. Order creation enforces the same rule.
 *     tags: [Restaurants]
 *     security: []
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties: { latitude: { type: number }, longitude: { type: number } }
 *     responses:
 *       200: { description: "{deliverable, distanceKm, radiusKm}" }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/:id/delivery-check', optionalAuth, deliveryCheckValidator, validate, restaurantGeoController.deliveryCheck);

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
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_READ_ALL),
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
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
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
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  restaurantController.remove
);

module.exports = router;
