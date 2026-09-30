const { body } = require('express-validator');

// Every field is optional (a partial update only touches what it sends) but
// must be a real boolean when present — matches
// notificationPreference.service.js's EDITABLE_FIELDS exactly.
const updatePreferencesValidator = [
  body('orderUpdates').optional().isBoolean().withMessage('orderUpdates must be a boolean'),
  body('paymentUpdates').optional().isBoolean().withMessage('paymentUpdates must be a boolean'),
  body('deliveryUpdates').optional().isBoolean().withMessage('deliveryUpdates must be a boolean'),
  body('supportUpdates').optional().isBoolean().withMessage('supportUpdates must be a boolean'),
  body('marketing').optional().isBoolean().withMessage('marketing must be a boolean'),
];

module.exports = { updatePreferencesValidator };
