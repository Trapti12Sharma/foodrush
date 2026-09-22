const { body } = require('express-validator');

const MAX_NOTE_LENGTH = 140;

const addItemValidator = [
  body('foodId').isMongoId().withMessage('A valid food id is required'),
  body('quantity').optional().isInt({ min: 1, max: 20 }).withMessage('Quantity must be between 1 and 20'),
  body('addons').optional().isArray(),
  body('addons.*.name').optional().isString(),
  body('addons.*.addonId').optional().isMongoId(),
  body('variantId').optional().isMongoId().withMessage('Invalid variant id'),
  body('note').optional({ checkFalsy: true }).trim().isLength({ max: MAX_NOTE_LENGTH }).withMessage(`Note must be at most ${MAX_NOTE_LENGTH} characters`),
];

const updateItemValidator = [
  body('quantity').isInt({ min: 1, max: 20 }).withMessage('Quantity must be between 1 and 20'),
];

module.exports = { addItemValidator, updateItemValidator, MAX_NOTE_LENGTH };
