const { body } = require('express-validator');
const { isSafeImageUrl } = require('../utils/imageUrl');

const createCategoryValidator = [
  body('restaurant').isMongoId().withMessage('A valid restaurant id is required'),
  body('name').trim().notEmpty().withMessage('Category name is required'),
  body('description').optional({ checkFalsy: true }).trim(),
  body('image').optional({ nullable: true }).custom(isSafeImageUrl).withMessage('image must be an uploaded image or an https:// URL'),
];

const updateCategoryValidator = [
  body('name').optional().trim().notEmpty(),
  body('description').optional({ checkFalsy: true }).trim(),
  body('isActive').optional().isBoolean(),
  body('image').optional({ nullable: true }).custom(isSafeImageUrl).withMessage('image must be an uploaded image or an https:// URL'),
];

module.exports = { createCategoryValidator, updateCategoryValidator };
