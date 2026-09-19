const express = require('express');
const { body } = require('express-validator');
const cartController = require('../controllers/cart.controller');
const { addItemValidator, updateItemValidator } = require('../validators/cart.validator');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /cart:
 *   get:
 *     summary: Get the signed-in customer's cart
 *     description: >
 *       Self-healing on every read: items whose FoodItem was deleted or made
 *       unavailable are silently dropped, an already-applied coupon is
 *       re-validated (dropped if it no longer qualifies), and every price is
 *       recomputed fresh from the current FoodItem/Restaurant — never trusted
 *       from the stored snapshot.
 *     tags: [Cart]
 *     responses:
 *       200:
 *         description: The cart
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { cart: { $ref: '#/components/schemas/Cart' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', cartController.getCart);

/**
 * @swagger
 * /cart/items:
 *   post:
 *     summary: Add an item to the cart
 *     description: >
 *       Rejected with 409 if the cart already has items from a different
 *       restaurant (data.existingRestaurantName tells the client which one) —
 *       a food-delivery cart can only ever hold one restaurant's items.
 *     tags: [Cart]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [foodId]
 *             properties:
 *               foodId: { type: string }
 *               quantity: { type: integer, minimum: 1, maximum: 20, default: 1 }
 *               addons:
 *                 type: array
 *                 items: { type: object, properties: { addonId: { type: string }, name: { type: string } } }
 *                 description: Each must match one of the food item's own addons — price always comes from that match, never from the client.
 *     responses:
 *       201:
 *         description: Updated cart
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { cart: { $ref: '#/components/schemas/Cart' } } } } }
 *       400: { description: 'Invalid addon, or the item is currently unavailable' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: Cart already has a different restaurant's items
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - { $ref: '#/components/schemas/ApiError' }
 *                 - { type: object, properties: { data: { type: object, properties: { existingRestaurantId: { type: string }, existingRestaurantName: { type: string } } } } }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/items', addItemValidator, validate, cartController.addItem);

/**
 * @swagger
 * /cart/items/{id}:
 *   put:
 *     summary: Change a cart line's quantity
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *         description: Cart item id (not the food id)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [quantity]
 *             properties:
 *               quantity: { type: integer, minimum: 1, maximum: 20 }
 *     responses:
 *       200:
 *         description: Updated cart
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { cart: { $ref: '#/components/schemas/Cart' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.put('/items/:id', updateItemValidator, validate, cartController.updateItem);

/**
 * @swagger
 * /cart/items/{id}:
 *   delete:
 *     summary: Remove one line from the cart
 *     tags: [Cart]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated cart
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { cart: { $ref: '#/components/schemas/Cart' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/items/:id', cartController.removeItem);

/**
 * @swagger
 * /cart:
 *   delete:
 *     summary: Empty the cart entirely (also clears the restaurant lock and any applied coupon)
 *     tags: [Cart]
 *     responses:
 *       200:
 *         description: The now-empty cart
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { cart: { $ref: '#/components/schemas/Cart' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.delete('/', cartController.clearCart);

/**
 * @swagger
 * /cart/coupon:
 *   post:
 *     summary: Apply a coupon code to the cart
 *     description: Re-validated (and silently dropped) on every subsequent cart read if it stops qualifying.
 *     tags: [Cart]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [code], properties: { code: { type: string } } }
 *     responses:
 *       200:
 *         description: Cart with the discount applied
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { cart: { $ref: '#/components/schemas/Cart' } } } } }
 *       400: { description: 'Invalid, expired, exhausted, or below-minimum-order coupon' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post(
  '/coupon',
  [body('code').trim().notEmpty().withMessage('Coupon code is required')],
  validate,
  cartController.applyCoupon
);

/**
 * @swagger
 * /cart/coupon:
 *   delete:
 *     summary: Remove the applied coupon from the cart
 *     tags: [Cart]
 *     responses:
 *       200:
 *         description: Cart with the discount removed
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { cart: { $ref: '#/components/schemas/Cart' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.delete('/coupon', cartController.removeCoupon);

module.exports = router;
