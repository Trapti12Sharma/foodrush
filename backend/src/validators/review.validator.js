const { body } = require('express-validator');
const { isSafeImageUrl } = require('../utils/imageUrl');
const { REVIEW_REPORT_REASON } = require('../utils/constants');

const reviewImages = body('images')
  .optional()
  .isArray({ max: 5 })
  .withMessage('At most 5 images')
  .bail()
  .custom((list) => list.every((url) => typeof url === 'string' && url !== '' && isSafeImageUrl(url)))
  .withMessage('images must be uploaded images or https:// URLs');

const createReviewValidator = [
  body('restaurant').isMongoId().withMessage('A valid restaurant id is required'),
  body('order').isMongoId().withMessage('A valid order id is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  reviewImages,
];

const updateReviewValidator = [
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('comment').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  reviewImages,
];

const reportReviewValidator = [
  body('reason').isIn(Object.values(REVIEW_REPORT_REASON)).withMessage(`reason must be one of: ${Object.values(REVIEW_REPORT_REASON).join(', ')}`),
];

// M21 — a restaurant's public answer. Length-capped to match the model, and
// notEmpty after trim so a reply of nothing but whitespace cannot be published.
const replyToReviewValidator = [
  body('text')
    .trim()
    .notEmpty()
    .withMessage('A reply cannot be empty')
    .isLength({ max: 1000 })
    .withMessage('A reply can be at most 1000 characters'),
];

module.exports = { createReviewValidator, updateReviewValidator, reportReviewValidator, replyToReviewValidator };
