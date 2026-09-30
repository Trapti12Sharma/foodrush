const mongoose = require('mongoose');
const {
  DELIVERY_KYC_STATUS,
  DELIVERY_ACCOUNT_STATUS,
  DELIVERY_AVAILABILITY,
  DELIVERY_VEHICLE_TYPES,
} = require('../utils/constants');

// Same GeoJSON-point shape as Restaurant.location (models/Restaurant.js) — deliberately
// NOT given a default, so a partner who has never sent a location simply has none
// instead of silently sitting at [0, 0] (the Atlantic Ocean). No fake/random values
// are ever written here; only a real device fix, via PATCH /delivery-partners/me/location.
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number], // [longitude, latitude]
      validate: {
        validator: (c) => Array.isArray(c) && c.length === 2 && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90,
        message: 'currentLocation.coordinates must be a real [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

const addressSchema = new mongoose.Schema(
  {
    addressLine: { type: String, required: true, trim: true },
    state: { type: String, trim: true },
    pincode: { type: String, trim: true },
  },
  { _id: false }
);

// KYC document images only — reuses the exact same Cloudinary/local-disk upload
// pipeline as restaurant/food images (storage.service.js via POST /uploads/image
// ?purpose=kyc), so these are ordinary https:// (or /uploads/...) URLs, never raw
// bytes in MongoDB. Nothing here is exposed by the admin LIST endpoint — only the
// single-partner detail endpoint (see deliveryPartner.service.js listForAdmin vs
// getByIdForAdmin) returns this sub-document.
const documentsSchema = new mongoose.Schema(
  {
    drivingLicenceUrl: { type: String, default: '' },
    vehicleRegistrationUrl: { type: String, default: '' },
    identityProofUrl: { type: String, default: '' },
    profilePhotoUrl: { type: String, default: '' },
  },
  { _id: false }
);

const emergencyContactSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
  },
  { _id: false }
);

const deliveryPartnerSchema = new mongoose.Schema(
  {
    // One profile per user account — enforced by the unique index below, and
    // checked with a friendly error in the service before that index is ever hit.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    fullName: {
      type: String,
      required: [true, 'Full name is required'],
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
    },
    // Optional: used only for the minimum-riding-age check a human reviewer makes
    // during KYC — not enforced in code in this foundation milestone.
    dateOfBirth: {
      type: Date,
      default: null,
    },
    address: {
      type: addressSchema,
      required: true,
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      index: true,
    },
    vehicleType: {
      type: String,
      enum: DELIVERY_VEHICLE_TYPES,
      required: true,
    },
    // Required for every motorised vehicle type; a bicycle has none (enforced in
    // the validator, not here, so the model stays a plain data container).
    vehicleNumber: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
    },
    drivingLicenceNumber: {
      type: String,
      trim: true,
      default: '',
    },
    drivingLicenceExpiry: {
      type: Date,
      default: null,
    },
    documents: {
      type: documentsSchema,
      default: () => ({}),
    },
    kycStatus: {
      type: String,
      enum: Object.values(DELIVERY_KYC_STATUS),
      default: DELIVERY_KYC_STATUS.SUBMITTED,
      index: true,
    },
    kycRejectionReason: {
      type: String,
      default: null,
    },
    kycReviewedAt: {
      type: Date,
      default: null,
    },
    kycReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    accountStatus: {
      type: String,
      enum: Object.values(DELIVERY_ACCOUNT_STATUS),
      default: DELIVERY_ACCOUNT_STATUS.PENDING,
      index: true,
    },
    // Free-text reason for the current SUSPENDED/REJECTED state, shown back to the
    // partner — separate from kycRejectionReason, which is specifically about why
    // documents were rejected.
    accountStatusReason: {
      type: String,
      default: null,
    },
    availability: {
      type: String,
      enum: Object.values(DELIVERY_AVAILABILITY),
      default: DELIVERY_AVAILABILITY.OFFLINE,
    },
    // GeoJSON point for later "nearby available riders" dispatch queries
    // (2dsphere index below) — foundation only; nothing reads this yet.
    currentLocation: { type: pointSchema, default: undefined },
    locationAccuracyMeters: {
      type: Number,
      default: null,
      min: 0,
    },
    lastLocationAt: {
      type: Date,
      default: null,
    },
    emergencyContact: {
      type: emergencyContactSchema,
      default: () => ({}),
    },
    // Deliberately no bank/payout fields in this milestone: there is no field-level
    // encryption in this codebase and no settlement system yet to use them safely
    // (settlements are explicitly out of scope — see constants.js DELIVERY_* enums
    // and the M6 plan). Add them only alongside real payout infrastructure.
  },
  { timestamps: true }
);

deliveryPartnerSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('DeliveryPartner', deliveryPartnerSchema);
