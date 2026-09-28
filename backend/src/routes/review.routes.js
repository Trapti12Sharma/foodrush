const express = require('express');
const reviewController = require('../controllers/review.controller');
const { createReviewValidator, updateReviewValidator, reportReviewValidator } = require('../validators/review.validator');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');
const { reviewLimiter } = require('../middleware/rateLimiter');

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
 *       the "write a review" button. A unique index on Review.order blocks a
 *       second review for the same order. The review starts moderationStatus
 *       "PENDING" (M15) — it does not affect the restaurant's public rating
 *       until an admin approves it, and it is only visible to its own author
 *       and to moderation staff until then.
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
router.post('/', authenticateUser, reviewLimiter, createReviewValidator, validate, reviewController.createReview);

/**
 * @swagger
 * /reviews/{id}:
 *   put:
 *     summary: Edit your own review (or an admin editing any review)
 *     description: >
 *       Changing rating/comment/images resets moderationStatus back to
 *       PENDING (M15) — an edited review needs a fresh look before it counts
 *       toward the rating again — then recalculates the restaurant's rating.
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

/**
 * @swagger
 * /reviews/{id}/report:
 *   post:
 *     summary: Report a review as inappropriate (M15)
 *     description: >
 *       One report per customer per review — a second attempt returns 409.
 *       Reporting your own review is rejected. Does not itself change the
 *       review's moderationStatus; it only raises reportCount/reportedAt for
 *       moderation staff to triage (GET /admin/reviews?reported=true).
 *     tags: [Reviews]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [reason]
 *             properties:
 *               reason: { type: string, enum: [SPAM, ABUSIVE, OFFENSIVE, FAKE, IRRELEVANT, OTHER] }
 *     responses:
 *       201: { description: Report recorded }
 *       400: { description: "You cannot report your own review" }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: "You have already reported this review" }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/:id/report', authenticateUser, reviewLimiter, reportReviewValidator, validate, reviewController.reportReview);

module.exports = router;
