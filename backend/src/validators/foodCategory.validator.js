const { body } = require('express-validator');

const createCategoryValidator = [
  body('restaurant').isMongoId().withMessage('A valid restaurant id is required'),
  body('name').trim().notEmpty().withMessage('Category name is required'),
  body('description').optional({ checkFalsy: true }).trim(),
];

const updateCategoryValidator = [
  body('name').optional().trim().notEmpty(),
  body('description').optional({ checkFalsy: true }).trim(),
  body('isActive').optional().isBoolean(),
];

module.exports = { createCategoryValidator, updateCategoryValidator };
