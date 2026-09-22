const express = require('express');
const { body } = require('express-validator');
const couponController = require('../controllers/coupon.controller');
const { createCouponValidator, updateCouponValidator } = require('../validators/coupon.validator');
const validate = require('../middleware/validate');
const { authenticateUser, requirePermission } = require('../middleware/auth.middleware');
const { PERMISSIONS } = require('../utils/permissions');

const router = express.Router();

/**
 * @swagger
 * /coupons/validate:
 *   post:
 *     summary: Check whether a coupon code is valid for a given subtotal
 *     description: A standalone check — doesn't touch the cart or increment usage. See POST /cart/coupon to actually apply one.
 *     tags: [Coupons]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, subtotal]
 *             properties:
 *               code: { type: string }
 *               subtotal: { type: number, minimum: 0 }
 *               restaurantId: { type: string, description: 'Required to validate a restaurant-scoped coupon' }
 *               city: { type: string, description: 'Required to validate a city-scoped coupon (ignored if restaurantId is set)' }
 *     responses:
 *       200:
 *         description: The coupon and the discount it would apply
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     code: { type: string }
 *                     discountType: { type: string, enum: [PERCENTAGE, FLAT] }
 *                     discountValue: { type: number }
 *                     discountAmount: { type: number }
 *       400: { description: 'Invalid, expired, exhausted, or below-minimum-order coupon' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/validate',
  authenticateUser,
  [
    body('code').trim().notEmpty().withMessage('Coupon code is required'),
    body('subtotal').isFloat({ min: 0 }),
    body('restaurantId').optional().isMongoId(),
    body('city').optional().isString().trim(),
  ],
  validate,
  couponController.validateCoupon
);

router.use(authenticateUser, requirePermission(PERMISSIONS.COUPONS_MANAGE));

/**
 * @swagger
 * /coupons:
 *   post:
 *     summary: Create a coupon (ADMIN only)
 *     tags: [Coupons]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code, discountType, discountValue, expiryDate]
 *             properties:
 *               code: { type: string, description: Uppercased and must be unique }
 *               description: { type: string }
 *               discountType: { type: string, enum: [PERCENTAGE, FLAT] }
 *               discountValue: { type: number, minimum: 0 }
 *               minimumOrder: { type: number, minimum: 0 }
 *               maximumDiscount: { type: number, nullable: true, description: 'Caps a PERCENTAGE discount' }
 *               expiryDate: { type: string, format: date-time }
 *               usageLimit: { type: integer, nullable: true, description: 'Omit for unlimited across all customers' }
 *               perUserLimit: { type: integer, nullable: true, description: 'Omit for unlimited uses per customer' }
 *               restaurant: { type: string, nullable: true, description: 'Scope to one restaurant (mutually exclusive with city)' }
 *               city: { type: string, nullable: true, description: 'Scope to every restaurant in a city' }
 *               fundedBy: { type: string, enum: [PLATFORM, RESTAURANT, SHARED], default: PLATFORM }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { coupon: { $ref: '#/components/schemas/Coupon' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409:
 *         description: A coupon with this code already exists
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/', createCouponValidator, validate, couponController.createCoupon);

/**
 * @swagger
 * /coupons:
 *   get:
 *     summary: List coupons (ADMIN only)
 *     tags: [Coupons]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: restaurant
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of coupons
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     coupons: { type: array, items: { $ref: '#/components/schemas/Coupon' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/', couponController.listCoupons);

/**
 * @swagger
 * /coupons/{id}:
 *   patch:
 *     summary: Update a coupon, including activating/deactivating it (ADMIN only)
 *     tags: [Coupons]
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
 *               description: { type: string }
 *               discountType: { type: string, enum: [PERCENTAGE, FLAT] }
 *               discountValue: { type: number }
 *               minimumOrder: { type: number }
 *               maximumDiscount: { type: number, nullable: true }
 *               expiryDate: { type: string, format: date-time }
 *               usageLimit: { type: integer, nullable: true }
 *               perUserLimit: { type: integer, nullable: true }
 *               restaurant: { type: string, nullable: true }
 *               city: { type: string, nullable: true }
 *               fundedBy: { type: string, enum: [PLATFORM, RESTAURANT, SHARED] }
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated coupon
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { coupon: { $ref: '#/components/schemas/Coupon' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch('/:id', updateCouponValidator, validate, couponController.updateCoupon);

module.exports = router;
