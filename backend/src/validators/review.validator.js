const { body } = require('express-validator');
const { isSafeImageUrl } = require('../utils/imageUrl');

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

module.exports = { createReviewValidator, updateReviewValidator };
