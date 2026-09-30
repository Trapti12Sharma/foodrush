const { body } = require('express-validator');
const { isSafeImageUrl } = require('../utils/imageUrl');
const { isValidLatitude, isValidLongitude } = require('../utils/geo');
const { DELIVERY_VEHICLE_TYPES, DELIVERY_AVAILABILITY } = require('../utils/constants');

const PHONE_RULE = /^\+?[0-9][0-9\s-]{6,14}$/;
const isMissing = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

// Deliberately reads req.body directly and checks the raw value itself rather than
// chaining .optional()/.trim()/.notEmpty() — express-validator string-coerces a
// genuinely absent field before some of those run, which would silently treat
// "missing" as the non-empty string "undefined". This mirrors the raw-value custom
// check pattern already used in address.validator.js (coordinatesArePairedAndReal).
function requiredTextUnlessBicycle(field, label) {
  return body(field).custom((value, { req }) => {
    if (req.body.vehicleType === 'BICYCLE') return true;
    if (isMissing(value)) throw new Error(`${label} is required for this vehicle type`);
    return true;
  });
}

function validDateUnlessBicycle(field, label) {
  return body(field).custom((value, { req }) => {
    const required = req.body.vehicleType !== 'BICYCLE';
    if (isMissing(value)) {
      if (required) throw new Error(`${label} is required for this vehicle type`);
      return true;
    }
    if (Number.isNaN(new Date(value).getTime())) throw new Error(`${label} must be a valid date`);
    return true;
  });
}

// `required` = always required (identity proof, profile photo); when false, a
// bicycle rider may leave it blank but every other vehicle type must provide it.
function documentUrlRule(field, label, { required = false } = {}) {
  return body(field).custom((value, { req }) => {
    const isRequired = required || req.body.vehicleType !== 'BICYCLE';
    if (isMissing(value)) {
      if (isRequired) throw new Error(`${label} is required`);
      return true;
    }
    if (!isSafeImageUrl(value)) throw new Error(`${label} must be an uploaded image`);
    return true;
  });
}

const optionalDocumentUrlRule = (field, label) =>
  body(field).custom((value) => {
    if (isMissing(value)) return true;
    if (!isSafeImageUrl(value)) throw new Error(`${label} must be an uploaded image`);
    return true;
  });

// Full submission — this is also what puts a new profile into kycStatus=SUBMITTED
// (see deliveryPartner.service.js), so everything a reviewer needs is required here.
const createDeliveryPartnerValidator = [
  body('fullName').trim().notEmpty().withMessage('Full name is required').isLength({ max: 100 }),
  body('phone').trim().matches(PHONE_RULE).withMessage('Enter a valid phone number'),
  body('dateOfBirth').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Enter a valid date of birth'),
  body('address.addressLine').trim().notEmpty().withMessage('Address line is required'),
  body('address.state').optional({ checkFalsy: true }).trim(),
  body('address.pincode').optional({ checkFalsy: true }).trim(),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('vehicleType').isIn(DELIVERY_VEHICLE_TYPES).withMessage(`vehicleType must be one of: ${DELIVERY_VEHICLE_TYPES.join(', ')}`),
  requiredTextUnlessBicycle('vehicleNumber', 'A vehicle number'),
  body('vehicleNumber').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  requiredTextUnlessBicycle('drivingLicenceNumber', 'A driving licence number'),
  validDateUnlessBicycle('drivingLicenceExpiry', 'A driving licence expiry date'),
  // Where the rider is based. Optional, but without it they are invisible to
  // dispatch: findEligibleRiders uses $geoNear, and $geoNear only ever returns
  // documents that actually carry the geo field — a rider with no location is
  // skipped no matter how close they are. Capturing it at sign-up means a rider
  // can be dispatched before they have ever switched on live location sharing.
  body('latitude').optional({ nullable: true, checkFalsy: true }).isFloat({ min: -90, max: 90 }).withMessage('Enter a valid latitude').toFloat(),
  body('longitude').optional({ nullable: true, checkFalsy: true }).isFloat({ min: -180, max: 180 }).withMessage('Enter a valid longitude').toFloat(),
  body('emergencyContact.name').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('emergencyContact.phone').optional({ checkFalsy: true }).trim().matches(PHONE_RULE).withMessage('Enter a valid emergency contact number'),
  documentUrlRule('documents.identityProofUrl', 'An identity document photo', { required: true }),
  documentUrlRule('documents.profilePhotoUrl', 'A profile photo', { required: true }),
  documentUrlRule('documents.drivingLicenceUrl', 'A driving licence photo'),
  documentUrlRule('documents.vehicleRegistrationUrl', 'A vehicle registration photo'),
];

// A partner may update their own profile/vehicle/document info at any time (does not
// re-trigger KYC review in this milestone — see deliveryPartner.service.js). Never
// includes kycStatus, accountStatus, availability or currentLocation: those are
// either admin-only or have their own dedicated, more tightly validated endpoints
// (the service also whitelists updatable fields independently of this validator).
const updateDeliveryPartnerValidator = [
  body('fullName').optional().trim().notEmpty().isLength({ max: 100 }),
  body('phone').optional().trim().matches(PHONE_RULE).withMessage('Enter a valid phone number'),
  body('dateOfBirth').optional({ nullable: true, checkFalsy: true }).isISO8601(),
  body('address.addressLine').optional().trim().notEmpty(),
  body('address.state').optional({ checkFalsy: true }).trim(),
  body('address.pincode').optional({ checkFalsy: true }).trim(),
  body('city').optional().trim().notEmpty(),
  body('vehicleType').optional().isIn(DELIVERY_VEHICLE_TYPES).withMessage(`vehicleType must be one of: ${DELIVERY_VEHICLE_TYPES.join(', ')}`),
  body('vehicleNumber').optional({ checkFalsy: true }).trim().isLength({ max: 20 }),
  body('drivingLicenceNumber').optional({ checkFalsy: true }).trim(),
  body('drivingLicenceExpiry').optional({ checkFalsy: true }).isISO8601(),
  optionalDocumentUrlRule('documents.identityProofUrl', 'documents.identityProofUrl'),
  optionalDocumentUrlRule('documents.profilePhotoUrl', 'documents.profilePhotoUrl'),
  optionalDocumentUrlRule('documents.drivingLicenceUrl', 'documents.drivingLicenceUrl'),
  optionalDocumentUrlRule('documents.vehicleRegistrationUrl', 'documents.vehicleRegistrationUrl'),
  body('emergencyContact.name').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('emergencyContact.phone').optional({ checkFalsy: true }).trim().matches(PHONE_RULE),
];

const availabilityValidator = [
  body('availability')
    .isIn(Object.values(DELIVERY_AVAILABILITY))
    .withMessage(`availability must be one of: ${Object.values(DELIVERY_AVAILABILITY).join(', ')}`),
];

const locationValidator = [
  body('latitude').custom((v) => isValidLatitude(Number(v))).withMessage('latitude must be a real value between -90 and 90'),
  body('longitude').custom((v) => isValidLongitude(Number(v))).withMessage('longitude must be a real value between -180 and 180'),
  body('accuracy').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('accuracy must be a positive number'),
];

module.exports = {
  createDeliveryPartnerValidator,
  updateDeliveryPartnerValidator,
  availabilityValidator,
  locationValidator,
};
