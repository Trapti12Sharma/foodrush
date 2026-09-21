const { body } = require('express-validator');
const { isSafeImageUrl } = require('../utils/imageUrl');
const { isValidPointCoordinates } = require('../utils/geo');

const locationRules = [
  body('location.coordinates')
    .optional()
    .custom((coordinates) => isValidPointCoordinates(coordinates))
    .withMessage('location.coordinates must be a real [longitude, latitude]'),
  body('deliveryRadiusKm').optional().isFloat({ min: 0.5, max: 50 }).withMessage('deliveryRadiusKm must be between 0.5 and 50'),
];

const imageRules = ['image', 'coverImage', 'logo'].map((field) =>
  body(field).optional({ nullable: true }).custom(isSafeImageUrl).withMessage(`${field} must be an uploaded image or an https:// URL`)
);

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
  ...locationRules,
  ...imageRules,
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
  ...locationRules,
  ...imageRules,
];

module.exports = { createRestaurantValidator, updateRestaurantValidator };
