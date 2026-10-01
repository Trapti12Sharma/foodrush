const { body } = require('express-validator');
const { isValidPointCoordinates } = require('../utils/geo');
const { isValidPincode } = require('../utils/indianDocuments');

const LABELS = ['Home', 'Work', 'Other'];
const isMissing = (v) => v === undefined || v === null || v === '';

function coordinatesArePairedAndReal(value, { req }) {
  const { latitude, longitude } = req.body;
  if (isMissing(latitude) !== isMissing(longitude)) throw new Error('latitude and longitude must be provided together');
  if (!isMissing(latitude) && !isValidPointCoordinates([Number(longitude), Number(latitude)])) {
    throw new Error('Coordinates are not a real location');
  }
  return true;
}

// Rules shared by create and update; on create the required fields are added below.
// Coordinates are optional (an address can be typed by hand) but must come as a pair, be
// in range, and not be the meaningless [0, 0] — those addresses are simply "unconfirmed".
const commonRules = [
  body('label').optional({ checkFalsy: true }).trim().isIn(LABELS).withMessage(`label must be one of: ${LABELS.join(', ')}`),
  body('name').optional({ checkFalsy: true }).trim().isLength({ max: 100 }).withMessage('Name is too long'),
  body('phone')
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^\+?[0-9][0-9\s-]{6,14}$/)
    .withMessage('Enter a valid phone number'),
  body('addressLine2').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('landmark').optional({ checkFalsy: true }).trim().isLength({ max: 150 }),
  body('state').optional({ checkFalsy: true }).trim(),
  body('latitude')
    .optional({ nullable: true })
    .isFloat({ min: -90, max: 90 })
    .withMessage('latitude must be between -90 and 90')
    .bail()
    .custom(coordinatesArePairedAndReal),
  // The pairing check lives on BOTH fields: each rule is skipped when its own field is absent,
  // so a lone longitude would otherwise slip past the latitude rule.
  body('longitude')
    .optional({ nullable: true })
    .isFloat({ min: -180, max: 180 })
    .withMessage('longitude must be between -180 and 180')
    .bail()
    .custom(coordinatesArePairedAndReal),
  body('isDefault').optional().isBoolean(),
];

const createAddressValidator = [
  body('addressLine').trim().notEmpty().withMessage('Address line is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('pincode').trim().notEmpty().withMessage('Pincode is required').bail().custom(isValidPincode).withMessage('Enter a valid 6-digit pincode'),
  ...commonRules,
];

const updateAddressValidator = [
  body('addressLine').optional().trim().notEmpty(),
  body('city').optional().trim().notEmpty(),
  body('pincode').optional().trim().notEmpty().bail().custom(isValidPincode).withMessage('Enter a valid 6-digit pincode'),
  ...commonRules,
];

module.exports = { createAddressValidator, updateAddressValidator };
