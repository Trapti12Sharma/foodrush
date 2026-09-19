const express = require('express');
const favoriteController = require('../controllers/favorite.controller');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /favorites:
 *   get:
 *     summary: List the signed-in customer's favorited restaurants
 *     tags: [Favorites]
 *     responses:
 *       200:
 *         description: Favorited restaurants, most recently favorited first
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurants: { type: array, items: { $ref: '#/components/schemas/Restaurant' } } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', favoriteController.list);

/**
 * @swagger
 * /favorites/{restaurantId}:
 *   post:
 *     summary: Favorite a restaurant
 *     description: Idempotent — favoriting an already-favorited restaurant is a no-op, not an error.
 *     tags: [Favorites]
 *     parameters:
 *       - in: path
 *         name: restaurantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       201: { description: Added to favorites }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.post('/:restaurantId', favoriteController.add);

/**
 * @swagger
 * /favorites/{restaurantId}:
 *   delete:
 *     summary: Remove a restaurant from favorites
 *     tags: [Favorites]
 *     parameters:
 *       - in: path
 *         name: restaurantId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed from favorites }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.delete('/:restaurantId', favoriteController.remove);

module.exports = router;
