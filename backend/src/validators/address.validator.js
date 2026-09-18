const { body } = require('express-validator');

const createAddressValidator = [
  body('label').optional({ checkFalsy: true }).trim(),
  body('addressLine').trim().notEmpty().withMessage('Address line is required'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('state').optional({ checkFalsy: true }).trim(),
  body('pincode').trim().notEmpty().withMessage('Pincode is required'),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('isDefault').optional().isBoolean(),
];

const updateAddressValidator = [
  body('label').optional({ checkFalsy: true }).trim(),
  body('addressLine').optional().trim().notEmpty(),
  body('city').optional().trim().notEmpty(),
  body('state').optional({ checkFalsy: true }).trim(),
  body('pincode').optional().trim().notEmpty(),
  body('latitude').optional().isFloat(),
  body('longitude').optional().isFloat(),
  body('isDefault').optional().isBoolean(),
];

module.exports = { createAddressValidator, updateAddressValidator };
