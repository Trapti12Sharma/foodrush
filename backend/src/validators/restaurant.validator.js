const { body } = require('express-validator');

const createRestaurantValidator = [
  body('name').trim().notEmpty().withMessage('Restaurant name is required').isLength({ max: 120 }),
  body('description').optional({ checkFalsy: true }).trim(),
  body('cuisine').isArray({ min: 1 }).withMessage('At least one cuisine is required'),
  body('cuisine.*').isString().trim().notEmpty(),
  body('address.addressLine').trim().notEmpty().withMessage('Address line is required'),
  body('address.state').optional({ checkFalsy: true }).trim(),
  body('address.pincode').optional({ checkFalsy: true }).trim(),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('deliveryTime').isFloat({ min: 0 }).withMessage('Delivery time must be a positive number'),
  body('deliveryFee').optional().isFloat({ min: 0 }),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('location.coordinates')
    .optional()
    .isArray({ min: 2, max: 2 })
    .withMessage('location.coordinates must be [lng, lat]'),
];

const updateRestaurantValidator = [
  body('name').optional().trim().notEmpty().isLength({ max: 120 }),
  body('description').optional({ checkFalsy: true }).trim(),
  body('cuisine').optional().isArray({ min: 1 }),
  body('cuisine.*').optional().isString().trim().notEmpty(),
  body('address.addressLine').optional().trim().notEmpty(),
  body('city').optional().trim().notEmpty(),
  body('deliveryTime').optional().isFloat({ min: 0 }),
  body('deliveryFee').optional().isFloat({ min: 0 }),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('isOpen').optional().isBoolean(),
  body('location.coordinates').optional().isArray({ min: 2, max: 2 }),
];

module.exports = { createRestaurantValidator, updateRestaurantValidator };
