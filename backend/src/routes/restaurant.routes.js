const express = require('express');
const restaurantController = require('../controllers/restaurant.controller');
const restaurantGeoController = require('../controllers/restaurantGeo.controller');
const { nearbyValidator, deliveryCheckValidator } = require('../validators/restaurantGeo.validator');
const dashboardController = require('../controllers/dashboard.controller');
const analyticsController = require('../controllers/analytics.controller');
const reviewController = require('../controllers/review.controller');
const { createRestaurantValidator, updateRestaurantValidator, submitKycValidator } = require('../validators/restaurant.validator');
const validate = require('../middleware/validate');
const {
  authenticateUser,
  authorizeRoles,
  requireOwnerOrPermission,
  optionalAuth,
} = require('../middleware/auth.middleware');
const { uploadSingleImage } = require('../middleware/upload.middleware');
const { uploadLimiter } = require('../middleware/rateLimiter');
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
 * /restaurants/{id}/analytics:
 *   get:
 *     summary: Date-ranged analytics for one restaurant (M16 — its own owner only)
 *     description: >
 *       The date-ranged counterpart to /restaurants/{id}/dashboard, which stays
 *       unchanged. Scoped to a single restaurant: ownership is re-derived from
 *       the authenticated user against the database, so the id in the path is
 *       only a lookup key — a forged one returns 403, never another owner's
 *       figures. Money definitions are identical to the admin analytics
 *       endpoints (grossSales over orders that reached DELIVERED, refunds =
 *       COMPLETED refunds on those orders, netSales = grossSales − refunds), so
 *       an owner and an admin looking at the same restaurant see the same
 *       numbers. lifetimeRating/lifetimeReviewCount are the restaurant's
 *       all-time public figures; reviewsInRange/averageRatingInRange cover only
 *       APPROVED reviews created inside the selected range. No customer names,
 *       emails or addresses are included.
 *     tags: [Analytics]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - $ref: '#/components/parameters/AnalyticsPreset'
 *       - $ref: '#/components/parameters/AnalyticsStartDate'
 *       - $ref: '#/components/parameters/AnalyticsEndDate'
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, minimum: 1, maximum: 100 }
 *         description: How many top menu items to return.
 *     responses:
 *       200:
 *         description: Owner-scoped analytics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     range: { type: object }
 *                     restaurant:
 *                       type: object
 *                       properties:
 *                         id: { type: string }
 *                         name: { type: string }
 *                     summary:
 *                       type: object
 *                       properties:
 *                         orders: { type: integer, description: Fulfilled orders behind the money figures }
 *                         grossSales: { type: number }
 *                         discounts: { type: number }
 *                         refunds: { type: number }
 *                         netSales: { type: number }
 *                         averageOrderValue: { type: number }
 *                         totalOrders: { type: integer }
 *                         fulfilledOrders: { type: integer }
 *                         cancelledOrders: { type: integer }
 *                         rejectedOrders: { type: integer }
 *                         completionRate: { type: number, nullable: true }
 *                         cancellationRate: { type: number, nullable: true }
 *                         lifetimeRating: { type: number }
 *                         lifetimeReviewCount: { type: integer }
 *                         reviewsInRange: { type: integer }
 *                         averageRatingInRange: { type: number, nullable: true }
 *                     trend: { type: array, items: { type: object } }
 *                     byStatus: { type: array, items: { type: object } }
 *                     topItems: { type: array, items: { type: object } }
 *       400: { $ref: '#/components/responses/AnalyticsBadRange' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: Not this owner's restaurant }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get(
  '/:id/analytics',
  authenticateUser,
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_READ_ALL),
  analyticsController.getRestaurantAnalytics
);

/**
 * @swagger
 * /restaurants/{id}/reviews:
 *   get:
 *     summary: List reviews for a restaurant
 *     description: >
 *       Public — always returns only APPROVED reviews (M15). A signed-in
 *       caller additionally sees their OWN review inline, whatever its
 *       moderationStatus, so they can see it awaiting review or why it was
 *       rejected; nobody else's non-approved reviews or moderation metadata
 *       are ever included.
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
router.get('/:id/reviews', optionalAuth, reviewController.listForRestaurant);

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
/**
 * @swagger
 * /restaurants/{id}/images/{type}:
 *   post:
 *     summary: Upload (or replace) one of this restaurant's images (its own owner, or admin)
 *     description: >
 *       A single self-contained request: validates the file (real JPEG/PNG/WEBP bytes, max
 *       MAX_UPLOAD_SIZE_MB, default 5MB), uploads it to Cloudinary (or local disk in
 *       development), persists the new URL + Cloudinary public_id, and only THEN removes the
 *       previous image for this slot — never the other way around, so a failed upload or a
 *       failed save never loses the existing image.
 *     tags: [Restaurants]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: type, required: true, schema: { type: string, enum: [image, coverImage, logo] } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, required: [image], properties: { image: { type: string, format: binary } } }
 *     responses:
 *       201:
 *         description: Uploaded — the updated restaurant
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       400: { description: 'No file, not a real image, wrong type param, or file too large' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       429: { description: Too many uploads }
 *       502: { description: Image storage provider unavailable }
 */
router.post(
  '/:id/images/:type',
  uploadLimiter,
  authenticateUser,
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  uploadSingleImage('image'),
  restaurantController.uploadImage
);

/**
 * @swagger
 * /restaurants/{id}/images/{type}:
 *   delete:
 *     summary: Delete one of this restaurant's images (its own owner, or admin)
 *     description: Deletes the Cloudinary asset first, and updates the restaurant record only once that succeeds — a genuine storage failure is reported as 502, never silently treated as done.
 *     tags: [Restaurants]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *       - { in: path, name: type, required: true, schema: { type: string, enum: [image, coverImage, logo] } }
 *     responses:
 *       200: { description: Deleted — the updated restaurant }
 *       400: { description: 'Wrong type param, or this restaurant has no image of that type' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       502: { description: Image storage provider could not delete the asset }
 */
router.delete(
  '/:id/images/:type',
  authenticateUser,
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  restaurantController.deleteImage
);

router.delete(
  '/:id',
  authenticateUser,
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  restaurantController.remove
);

/**
 * @swagger
 * /restaurants/{id}/kyc/submit:
 *   post:
 *     summary: Submit (or resubmit) this restaurant's business-verification documents (its own owner, or admin)
 *     description: >
 *       Only valid from NOT_SUBMITTED, REJECTED (fix and resubmit) or VERIFIED (e.g. renewing an
 *       expired licence) — never while a submission is already awaiting review. Uploads for the
 *       document images go through the existing image pipeline first
 *       (`POST /uploads/image?purpose=restaurantkyc`); this endpoint then records the resulting
 *       URLs. Never touches `isApproved`/`isActive` — an already-live restaurant stays live while
 *       a fresh KYC review is pending.
 *     tags: [Restaurants]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fssaiLicenseNumber, fssaiCertificateUrl, panNumber, panCardUrl, ownerIdentityProofUrl]
 *             properties:
 *               fssaiLicenseNumber: { type: string }
 *               fssaiCertificateUrl: { type: string, description: 'URL from POST /uploads/image?purpose=restaurantkyc' }
 *               panNumber: { type: string }
 *               panCardUrl: { type: string }
 *               ownerIdentityProofUrl: { type: string }
 *               gstNumber: { type: string, description: 'Optional — not every restaurant is required to be GST-registered' }
 *               gstCertificateUrl: { type: string }
 *     responses:
 *       200:
 *         description: Submitted — kycStatus is now SUBMITTED
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       400: { description: 'Cannot submit from the current KYC status (already awaiting review)' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/:id/kyc/submit',
  authenticateUser,
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  submitKycValidator,
  validate,
  restaurantController.submitKyc
);

module.exports = router;
