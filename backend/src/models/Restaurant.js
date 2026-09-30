const mongoose = require('mongoose');
const { isOpenNow } = require('../utils/openingHours');
const { RESTAURANT_KYC_STATUS } = require('../utils/constants');

// M14 — business-verification documents only, uploaded through the existing
// Cloudinary/local-disk pipeline (storage.service.js via POST
// /uploads/image?purpose=restaurant-kyc) exactly like every other image in this
// app — ordinary https:// (or /uploads/...) URLs, never raw bytes in MongoDB.
// GST is deliberately optional: GST registration is only mandatory above a
// turnover threshold in India, so many small restaurants legitimately have none.
const kycDocumentsSchema = new mongoose.Schema(
  {
    fssaiLicenseNumber: { type: String, trim: true, default: '' },
    fssaiCertificateUrl: { type: String, default: '' },
    panNumber: { type: String, trim: true, uppercase: true, default: '' },
    panCardUrl: { type: String, default: '' },
    gstNumber: { type: String, trim: true, uppercase: true, default: '' },
    gstCertificateUrl: { type: String, default: '' },
    ownerIdentityProofUrl: { type: String, default: '' },
  },
  { _id: false }
);

// A restaurant's position. Deliberately a sub-schema with NO default: a restaurant that has
// not been given a location simply has none, instead of silently sitting at [0, 0]
// (the Atlantic Ocean) where it would corrupt every "near me" result. Documents that
// already have a location are unaffected.
const pointSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: {
      type: [Number], // [longitude, latitude]
      validate: {
        validator: (c) => Array.isArray(c) && c.length === 2 && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90 && !(c[0] === 0 && c[1] === 0),
        message: 'location.coordinates must be a real [longitude, latitude]',
      },
    },
  },
  { _id: false }
);

const restaurantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Restaurant name is required'],
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // `image` is the card thumbnail; `coverImage` the wide banner on the restaurant page.
    image: {
      type: String,
      default: '',
    },
    coverImage: {
      type: String,
      default: '',
    },
    logo: {
      type: String,
      default: '',
    },
    // M13 — the Cloudinary public_id backing each URL above, when it is one of ours,
    // so a later replace/delete can remove the exact right asset directly rather than
    // re-deriving it from the URL (see utils/imageUrl.js#parseCloudinaryUrl, still used
    // as a fallback for records that predate this field). Always server-derived — see
    // restaurant.service.js — never accepted directly from a client. null for a
    // pre-M13 record, an externally-set https:// URL, or local dev storage.
    imagePublicId: { type: String, default: null },
    coverImagePublicId: { type: String, default: null },
    logoPublicId: { type: String, default: null },
    cuisine: {
      type: [String],
      required: true,
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: 'At least one cuisine is required',
      },
    },
    address: {
      addressLine: { type: String, required: true, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true,
      index: true,
    },
    // GeoJSON point for "restaurants near me" queries (2dsphere index below).
    location: { type: pointSchema, default: undefined },
    // How far from `location` this restaurant will deliver, in km.
    deliveryRadiusKm: {
      type: Number,
      default: 20,
      min: 0.5,
      max: 50,
    },
    rating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
    },
    totalReviews: {
      type: Number,
      default: 0,
      min: 0,
    },
    deliveryTime: {
      type: Number, // estimated minutes
      required: true,
      min: 0,
    },
    deliveryFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    minimumOrder: {
      type: Number,
      default: 0,
      min: 0,
    },
    // Manual pause switch — false always means closed, regardless of openingHours.
    isOpen: {
      type: Boolean,
      default: true,
    },
    // Weekly schedule; see utils/openingHours.js. Empty = no schedule set = always open
    // (unaffected by isOpen), which is how every restaurant behaved before this existed.
    openingHours: {
      type: [
        {
          _id: false,
          day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
          open: { type: Number, min: 0, max: 1439, required: true }, // minutes since midnight
          close: { type: Number, min: 0, max: 1439, required: true },
        },
      ],
      default: [],
    },
    timezone: {
      type: String,
      default: 'Asia/Kolkata',
    },
    // Admin approval gate — a new restaurant is inactive/unapproved until an admin
    // reviews it (section 12: "Approve restaurants"), separate from isActive which
    // an admin can also use to disable a previously-approved restaurant.
    isApproved: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // M14 — tracks business-paperwork review, entirely separate from
    // isApproved/isActive above (see RESTAURANT_KYC_TRANSITIONS's own comment for
    // why). New restaurants start NOT_SUBMITTED; a restaurant created before M14
    // is backfilled by scripts/migrate-restaurant-kyc.js, never left inconsistent
    // by this field's mere addition.
    kycStatus: {
      type: String,
      enum: Object.values(RESTAURANT_KYC_STATUS),
      default: RESTAURANT_KYC_STATUS.NOT_SUBMITTED,
      index: true,
    },
    kycDocuments: { type: kycDocumentsSchema, default: () => ({}) },
    kycRejectionReason: { type: String, default: null },
    kycSubmittedAt: { type: Date, default: null },
    kycReviewedAt: { type: Date, default: null },
    kycReviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

restaurantSchema.index({ location: '2dsphere' });
restaurantSchema.index({ name: 'text', cuisine: 'text' });

// Computed, not stored: whether the restaurant is actually taking orders right now
// (the manual `isOpen` pause AND the `openingHours` schedule). Included on every JSON
// response so the frontend never has to reimplement the opening-hours rule itself.
restaurantSchema.virtual('isOpenNow').get(function getIsOpenNow() {
  return isOpenNow(this);
});
restaurantSchema.set('toJSON', { virtuals: true });
restaurantSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Restaurant', restaurantSchema);
