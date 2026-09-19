const express = require('express');
const reviewController = require('../controllers/review.controller');
const { createReviewValidator, updateReviewValidator } = require('../validators/review.validator');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * @swagger
 * /reviews:
 *   post:
 *     summary: Submit a review for a delivered order
 *     description: >
 *       Only the customer whose own order this is, and only once that order
 *       has reached orderStatus=delivered, may review it — enforced
 *       server-side by re-loading the order, not just by the frontend hiding
 *       the "write a review" button. The order's restaurant.rating and
 *       totalReviews are recalculated immediately. A unique index on
 *       Review.order blocks a second review for the same order.
 *     tags: [Reviews]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [restaurant, order, rating]
 *             properties:
 *               restaurant: { type: string }
 *               order: { type: string, description: "Must belong to the requesting customer and be delivered" }
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string, maxLength: 1000 }
 *               images: { type: array, items: { type: string } }
 *     responses:
 *       201:
 *         description: Review created
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { review: { $ref: '#/components/schemas/Review' } } } } }
 *       400: { description: "Order isn't delivered yet, or doesn't match the given restaurant" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { description: "Not this customer's own order" }
 *       409:
 *         description: This order has already been reviewed
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/', authenticateUser, createReviewValidator, validate, reviewController.createReview);

/**
 * @swagger
 * /reviews/{id}:
 *   put:
 *     summary: Edit your own review (or an admin editing any review)
 *     description: Recalculates the restaurant's rating afterward.
 *     tags: [Reviews]
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
 *               rating: { type: integer, minimum: 1, maximum: 5 }
 *               comment: { type: string, maxLength: 1000 }
 *               images: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Updated review
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { review: { $ref: '#/components/schemas/Review' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.put('/:id', authenticateUser, updateReviewValidator, validate, reviewController.updateReview);

/**
 * @swagger
 * /reviews/{id}:
 *   delete:
 *     summary: Delete your own review (or an admin deleting any review)
 *     description: Recalculates the restaurant's rating afterward.
 *     tags: [Reviews]
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
router.delete('/:id', authenticateUser, reviewController.deleteReview);

module.exports = router;
