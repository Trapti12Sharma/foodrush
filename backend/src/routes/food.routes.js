const express = require('express');
const foodController = require('../controllers/foodItem.controller');
const { createFoodValidator, updateFoodValidator } = require('../validators/foodItem.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles, optionalAuth } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

/**
 * @swagger
 * /foods:
 *   get:
 *     summary: Search/browse food items
 *     description: >
 *       With `restaurant` set: customers see only isAvailable items; that restaurant's
 *       owner or an admin sees everything (menu-management view). Without `restaurant`:
 *       a platform-wide search scoped to publicly-visible (approved+active) restaurants only.
 *     tags: [Foods]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: restaurant
 *         schema: { type: string }
 *       - in: query
 *         name: category
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: isVeg
 *         schema: { type: boolean }
 *       - in: query
 *         name: hasOffer
 *         schema: { type: boolean }
 *         description: 'true = only items with an active discountPrice'
 *       - in: query
 *         name: minPrice
 *         schema: { type: number }
 *       - in: query
 *         name: maxPrice
 *         schema: { type: number }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [price_asc, price_desc, name, newest] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of food items
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     foods: { type: array, items: { $ref: '#/components/schemas/FoodItem' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/', optionalAuth, foodController.list);

/**
 * @swagger
 * /foods/{id}:
 *   get:
 *     summary: Get one food item by id
 *     description: Hidden (404) if its restaurant isn't publicly visible, unless the requester owns it or is an admin.
 *     tags: [Foods]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The food item
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { food: { $ref: '#/components/schemas/FoodItem' } } } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', optionalAuth, foodController.getById);

/**
 * @swagger
 * /foods:
 *   post:
 *     summary: Create a food item (owner of the target restaurant, or admin)
 *     description: The category must belong to the same restaurant, or this is rejected.
 *     tags: [Foods]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [restaurant, category, name, price, isVeg]
 *             properties:
 *               restaurant: { type: string }
 *               category: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *               price: { type: number, minimum: 0 }
 *               discountPrice: { type: number, minimum: 0, description: 'Must be <= price, enforced at the model level' }
 *               isVeg: { type: boolean }
 *               preparationTime: { type: integer, description: minutes }
 *               addons:
 *                 type: array
 *                 items: { type: object, properties: { name: { type: string }, price: { type: number } } }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { food: { $ref: '#/components/schemas/FoodItem' } } } } }
 *       400: { description: 'Category does not belong to this restaurant' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  createFoodValidator,
  validate,
  foodController.create
);

/**
 * @swagger
 * /foods/{id}:
 *   put:
 *     summary: Update a food item (owner of its restaurant, or admin)
 *     tags: [Foods]
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
 *               category: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *               price: { type: number }
 *               discountPrice: { type: number, nullable: true }
 *               isVeg: { type: boolean }
 *               isAvailable: { type: boolean }
 *               preparationTime: { type: integer }
 *               addons: { type: array, items: { type: object } }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { food: { $ref: '#/components/schemas/FoodItem' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.put(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateFoodValidator,
  validate,
  foodController.update
);

/**
 * @swagger
 * /foods/{id}:
 *   delete:
 *     summary: Delete a food item (owner of its restaurant, or admin)
 *     description: A hard delete — safe for order history because Order.items stores a frozen name/price snapshot, not a live reference.
 *     tags: [Foods]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  foodController.remove
);

module.exports = router;
