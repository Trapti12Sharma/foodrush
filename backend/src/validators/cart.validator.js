const { body } = require('express-validator');

const addItemValidator = [
  body('foodId').isMongoId().withMessage('A valid food id is required'),
  body('quantity').optional().isInt({ min: 1, max: 20 }).withMessage('Quantity must be between 1 and 20'),
  body('addons').optional().isArray(),
  body('addons.*.name').optional().isString(),
  body('addons.*.addonId').optional().isMongoId(),
];

const updateItemValidator = [
  body('quantity').isInt({ min: 1, max: 20 }).withMessage('Quantity must be between 1 and 20'),
];

module.exports = { addItemValidator, updateItemValidator };
