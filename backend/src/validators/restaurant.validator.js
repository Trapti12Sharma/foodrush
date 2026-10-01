const { body } = require('express-validator');
const { isSafeImageUrl } = require('../utils/imageUrl');
const { isValidPointCoordinates } = require('../utils/geo');
const { MAX_SLOTS, isValidTimezone } = require('../utils/openingHours');
const { isValidPan, isValidFssaiNumber, isValidGstNumber, isValidPincode } = require('../utils/indianDocuments');

const TIME_RULE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const scheduleRules = [
  body('openingHours').optional().isArray({ max: MAX_SLOTS }).withMessage(`At most ${MAX_SLOTS} opening-hour slots are allowed`),
  body('openingHours.*.day').optional().isInt({ min: 0, max: 6 }).withMessage('day must be 0 (Sunday) to 6 (Saturday)'),
  body('openingHours.*.open').optional().matches(TIME_RULE).withMessage('open must be 24-hour HH:MM'),
  body('openingHours.*.close').optional().matches(TIME_RULE).withMessage('close must be 24-hour HH:MM'),
  body('timezone').optional().isString().trim().custom(isValidTimezone).withMessage('Unknown timezone'),
];

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
  body('address.pincode').optional({ checkFalsy: true }).trim().custom(isValidPincode).withMessage('Enter a valid 6-digit pincode'),
  body('city').trim().notEmpty().withMessage('City is required'),
  body('deliveryTime').isFloat({ min: 0 }).withMessage('Delivery time must be a positive number'),
  body('deliveryFee').optional().isFloat({ min: 0 }),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  ...locationRules,
  ...imageRules,
  ...scheduleRules,
];

const updateRestaurantValidator = [
  body('name').optional().trim().notEmpty().isLength({ max: 120 }),
  body('description').optional({ checkFalsy: true }).trim(),
  body('cuisine').optional().isArray({ min: 1 }),
  body('cuisine.*').optional().isString().trim().notEmpty(),
  body('address.addressLine').optional().trim().notEmpty(),
  body('address.pincode').optional({ checkFalsy: true }).trim().custom(isValidPincode).withMessage('Enter a valid 6-digit pincode'),
  body('city').optional().trim().notEmpty(),
  body('deliveryTime').optional().isFloat({ min: 0 }),
  body('deliveryFee').optional().isFloat({ min: 0 }),
  body('minimumOrder').optional().isFloat({ min: 0 }),
  body('isOpen').optional().isBoolean(),
  ...locationRules,
  ...imageRules,
  ...scheduleRules,
];

// M14 — every document a reviewer needs for a real business-verification decision,
// matching the exact "a successful submission always represents a complete
// submission" convention deliveryPartner.validator.js already uses for KYC. GST
// stays optional (see the Restaurant model's own comment on kycDocumentsSchema).
// isSafeImageUrl alone treats '' as valid (a normal, optional image field may be
// cleared) — these documents are mandatory, so notEmpty() is checked first.
const submitKycValidator = [
  // Format checks only (see utils/indianDocuments.js) — genuineness is what the
  // human KYC review step is for. Previously these only checked "non-empty,
  // under N characters", which random text satisfies as easily as a real
  // document number, so an obviously-fake PAN/FSSAI/GST number reached a
  // reviewer indistinguishable from a real one.
  body('fssaiLicenseNumber').trim().notEmpty().withMessage('FSSAI license number is required').bail().custom(isValidFssaiNumber).withMessage('FSSAI license number must be 14 digits'),
  body('fssaiCertificateUrl').trim().notEmpty().withMessage('FSSAI certificate is required').custom(isSafeImageUrl).withMessage('fssaiCertificateUrl must be an uploaded image or an https:// URL'),
  body('panNumber').trim().notEmpty().withMessage('PAN number is required').bail().custom(isValidPan).withMessage('Enter a valid PAN number (e.g. ABCDE1234F)'),
  body('panCardUrl').trim().notEmpty().withMessage('PAN card image is required').custom(isSafeImageUrl).withMessage('panCardUrl must be an uploaded image or an https:// URL'),
  body('ownerIdentityProofUrl').trim().notEmpty().withMessage('An identity proof is required').custom(isSafeImageUrl).withMessage('ownerIdentityProofUrl must be an uploaded image or an https:// URL'),
  body('gstNumber').optional({ checkFalsy: true }).trim().custom(isValidGstNumber).withMessage('Enter a valid 15-character GST number'),
  body('gstCertificateUrl').optional({ checkFalsy: true }).custom(isSafeImageUrl).withMessage('gstCertificateUrl must be an uploaded image or an https:// URL'),
];

module.exports = { createRestaurantValidator, updateRestaurantValidator, submitKycValidator };
