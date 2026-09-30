const { query, body, param } = require('express-validator');

const SORT_KEYS = ['recommended', 'distance', 'rating', 'deliveryTime', 'deliveryFee', 'price'];
const FLAGS = ['veg', 'nonVeg', 'hasOffer', 'openNow', 'includeOutOfRange'];

const nearbyValidator = [
  query('lat').isFloat({ min: -90, max: 90 }).withMessage('lat must be between -90 and 90'),
  query('lng').isFloat({ min: -180, max: 180 }).withMessage('lng must be between -180 and 180'),
  query('radius').optional().isFloat({ min: 0.5, max: 50 }).withMessage('radius must be between 0.5 and 50 (km)'),
  query('minRating').optional().isFloat({ min: 0, max: 5 }),
  query('maxDeliveryTime').optional().isInt({ min: 1, max: 240 }),
  query('maxPrice').optional().isFloat({ min: 1 }),
  query('sort').optional().isIn(SORT_KEYS).withMessage(`sort must be one of: ${SORT_KEYS.join(', ')}`),
  query('search').optional().isString().isLength({ max: 100 }),
  query('cuisine').optional().isString().isLength({ max: 60 }),
  ...FLAGS.map((flag) => query(flag).optional().isIn(['true', 'false']).withMessage(`${flag} must be true or false`)),
];

const deliveryCheckValidator = [
  param('id').isMongoId().withMessage('Invalid restaurant id'),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('latitude must be between -90 and 90'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('longitude must be between -180 and 180'),
];

module.exports = { nearbyValidator, deliveryCheckValidator };
