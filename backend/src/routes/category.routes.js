const express = require('express');
const categoryController = require('../controllers/foodCategory.controller');
const { createCategoryValidator, updateCategoryValidator } = require('../validators/foodCategory.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles, optionalAuth } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

/**
 * @swagger
 * /categories:
 *   get:
 *     summary: List categories for a restaurant
 *     description: Customers only see isActive categories; the restaurant's own owner or an admin also sees inactive ones.
 *     tags: [Categories]
 *     security: []
 *     parameters:
 *       - in: query
 *         name: restaurant
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Categories for the restaurant
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { categories: { type: array, items: { $ref: '#/components/schemas/FoodCategory' } } } } } }
 *       400: { description: Missing restaurant query param }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/', optionalAuth, categoryController.list);

/**
 * @swagger
 * /categories/{id}:
 *   get:
 *     summary: Get one category by id
 *     tags: [Categories]
 *     security: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The category
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { category: { $ref: '#/components/schemas/FoodCategory' } } } } }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/:id', categoryController.getById);

/**
 * @swagger
 * /categories:
 *   post:
 *     summary: Create a category (owner of the target restaurant, or admin)
 *     tags: [Categories]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [restaurant, name]
 *             properties:
 *               restaurant: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *               image: { type: string }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { category: { $ref: '#/components/schemas/FoodCategory' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409:
 *         description: A category with this name already exists for this restaurant
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  createCategoryValidator,
  validate,
  categoryController.create
);

/**
 * @swagger
 * /categories/{id}:
 *   put:
 *     summary: Update a category (owner of its restaurant, or admin)
 *     tags: [Categories]
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
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { category: { $ref: '#/components/schemas/FoodCategory' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.put(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateCategoryValidator,
  validate,
  categoryController.update
);

/**
 * @swagger
 * /categories/{id}:
 *   delete:
 *     summary: Delete a category (owner of its restaurant, or admin)
 *     description: Blocked while the category still has food items — move or delete them first.
 *     tags: [Categories]
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
 *       409: { $ref: '#/components/responses/Conflict' }
 */
router.delete(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  categoryController.remove
);

module.exports = router;
