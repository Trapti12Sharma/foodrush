const { body } = require('express-validator');

const createFoodValidator = [
  body('restaurant').isMongoId().withMessage('A valid restaurant id is required'),
  body('category').isMongoId().withMessage('A valid category id is required'),
  body('name').trim().notEmpty().withMessage('Food name is required'),
  body('description').optional({ checkFalsy: true }).trim(),
  body('price').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
  body('discountPrice').optional().isFloat({ min: 0 }),
  body('isVeg').isBoolean().withMessage('isVeg must be true or false'),
  body('preparationTime').optional().isInt({ min: 0 }),
  body('addons').optional().isArray(),
  body('addons.*.name').optional().isString().trim().notEmpty(),
  body('addons.*.price').optional().isFloat({ min: 0 }),
];

const updateFoodValidator = [
  body('category').optional().isMongoId(),
  body('name').optional().trim().notEmpty(),
  body('description').optional({ checkFalsy: true }).trim(),
  body('price').optional().isFloat({ min: 0 }),
  body('discountPrice').optional({ nullable: true }).isFloat({ min: 0 }),
  body('isVeg').optional().isBoolean(),
  body('isAvailable').optional().isBoolean(),
  body('preparationTime').optional().isInt({ min: 0 }),
  body('addons').optional().isArray(),
  body('addons.*.name').optional().isString().trim().notEmpty(),
  body('addons.*.price').optional().isFloat({ min: 0 }),
];

module.exports = { createFoodValidator, updateFoodValidator };
