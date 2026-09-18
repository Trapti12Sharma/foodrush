const { body } = require('express-validator');

const createReviewValidator = [
  body('restaurant').isMongoId().withMessage('A valid restaurant id is required'),
  body('order').isMongoId().withMessage('A valid order id is required'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  body('images').optional().isArray(),
];

const updateReviewValidator = [
  body('rating').optional().isInt({ min: 1, max: 5 }),
  body('comment').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  body('images').optional().isArray(),
];

module.exports = { createReviewValidator, updateReviewValidator };
