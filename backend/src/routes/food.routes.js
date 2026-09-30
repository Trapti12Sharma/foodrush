const express = require('express');
const foodController = require('../controllers/foodItem.controller');
const { createFoodValidator, updateFoodValidator } = require('../validators/foodItem.validator');
const validate = require('../middleware/validate');
const { authenticateUser, requireOwnerOrPermission, optionalAuth } = require('../middleware/auth.middleware');
const { uploadSingleImage } = require('../middleware/upload.middleware');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { PERMISSIONS } = require('../utils/permissions');

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
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
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
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
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
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  foodController.remove
);

/**
 * @swagger
 * /foods/{id}/image:
 *   post:
 *     summary: Upload (or replace) a food item's image (owner of its restaurant, or admin)
 *     description: >
 *       A single self-contained request: validates the file (real JPEG/PNG/WEBP bytes, max
 *       MAX_UPLOAD_SIZE_MB), uploads it to Cloudinary (or local disk in development), persists
 *       the new URL + Cloudinary public_id, and only THEN removes the previous image — never
 *       the other way around.
 *     tags: [Foods]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema: { type: object, required: [image], properties: { image: { type: string, format: binary } } }
 *     responses:
 *       201:
 *         description: Uploaded — the updated food item
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { food: { $ref: '#/components/schemas/FoodItem' } } } } }
 *       400: { description: 'No file, not a real image, or file too large' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       429: { description: Too many uploads }
 *       502: { description: Image storage provider unavailable }
 */
router.post(
  '/:id/image',
  uploadLimiter,
  authenticateUser,
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  uploadSingleImage('image'),
  foodController.uploadImage
);

/**
 * @swagger
 * /foods/{id}/image:
 *   delete:
 *     summary: Delete a food item's image (owner of its restaurant, or admin)
 *     description: Deletes the Cloudinary asset first, and updates the food item only once that succeeds — a genuine storage failure is reported as 502, never silently treated as done.
 *     tags: [Foods]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Deleted — the updated food item }
 *       400: { description: This food item has no image to delete }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       502: { description: Image storage provider could not delete the asset }
 */
router.delete(
  '/:id/image',
  authenticateUser,
  requireOwnerOrPermission(PERMISSIONS.RESTAURANTS_MANAGE),
  foodController.deleteImage
);

module.exports = router;
