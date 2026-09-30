const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { assertOwnerOrAdmin } = require('../utils/ownership');
const { PERMISSIONS, hasPermission } = require('../utils/permissions');
const storageService = require('./storage.service');
const notificationService = require('./notification.service');
const { normalizeSlots } = require('../utils/openingHours');
const { parseCloudinaryUrl } = require('../utils/imageUrl');
const { RESTAURANT_KYC_STATUS, RESTAURANT_KYC_TRANSITIONS, NOTIFICATION_TYPE } = require('../utils/constants');

const SORT_MAP = {
  rating: '-rating',
  deliveryTime: 'deliveryTime',
  deliveryFee: 'deliveryFee',
  newest: '-createdAt',
};

const CREATE_FIELDS = [
  'name',
  'description',
  'image',
  'coverImage',
  'logo',
  'cuisine',
  'address',
  'city',
  'location',
  'deliveryRadiusKm',
  'deliveryTime',
  'deliveryFee',
  'minimumOrder',
  'openingHours',
  'timezone',
];

const UPDATE_FIELDS = [...CREATE_FIELDS, 'isOpen'];
const IMAGE_FIELDS = ['image', 'coverImage', 'logo'];

// Always computed server-side from the URL itself — an *PublicId value is NEVER
// accepted as a client-settable field (that would let a client claim an arbitrary
// publicId, e.g. one under a different owner or purpose, causing a later
// replace/delete to act on the wrong Cloudinary asset). Returns null for anything
// that isn't one of our own Cloudinary uploads (an external https:// URL, a local
// /uploads/ path, or empty) — correctly nothing to clean up later either way.
function derivePublicId(url) {
  return parseCloudinaryUrl(url)?.publicId || null;
}

function isPubliclyVisible(restaurant) {
  return restaurant.isApproved && restaurant.isActive;
}

// A restaurant not yet approved (or disabled by an admin) is invisible to the
// public — only its owner or an admin can see it, e.g. while it's pending review.
function canView(restaurant, requester) {
  if (isPubliclyVisible(restaurant)) return true;
  if (!requester) return false;
  return hasPermission(requester, PERMISSIONS.RESTAURANTS_READ_ALL) || restaurant.owner.toString() === requester._id.toString();
}

async function listPublicRestaurants(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { isApproved: true, isActive: true };

  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: re }, { cuisine: re }];
  }
  if (query.cuisine) {
    filter.cuisine = new RegExp(`^${escapeRegex(query.cuisine)}$`, 'i');
  }
  if (query.city) {
    filter.city = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
  }
  if (query.minRating) {
    filter.rating = { $gte: Number(query.minRating) };
  }
  if (query.maxDeliveryTime) {
    filter.deliveryTime = { $lte: Number(query.maxDeliveryTime) };
  }
  if (query.isOpen === 'true') {
    filter.isOpen = true;
  }

  // "Restaurants near me" — query.near is "lng,lat" from the browser Geolocation API.
  // $near always returns results pre-sorted by distance, so it can't be combined with
  // a regular .sort(); and $near isn't valid inside an aggregation $match, so we skip
  // the countDocuments() total for this branch rather than force an inaccurate one.
  const nearMatch = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(query.near || '');
  if (nearMatch) {
    const [, lng, lat] = nearMatch;
    filter.location = {
      $near: {
        $geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
        $maxDistance: (Number(query.maxDistanceKm) || 10) * 1000,
      },
    };
    const items = await Restaurant.find(filter).skip(skip).limit(limit);
    return { items, pagination: buildPaginationMeta(items.length, page, limit) };
  }

  const sort = SORT_MAP[query.sort] || '-rating';

  const [items, total] = await Promise.all([
    Restaurant.find(filter).sort(sort).skip(skip).limit(limit),
    Restaurant.countDocuments(filter),
  ]);

  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function listMyRestaurants(owner) {
  return Restaurant.find({ owner: owner._id }).sort('-createdAt');
}

async function getRestaurantById(id, requester) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant || !canView(restaurant, requester)) {
    // Same 404 whether it doesn't exist or is just hidden — don't leak existence
    // of an unapproved/disabled restaurant to strangers.
    throw ApiError.notFound('Restaurant not found');
  }
  return restaurant;
}

function pickFields(source, fields) {
  const result = {};
  fields.forEach((field) => {
    if (source[field] !== undefined) result[field] = source[field];
  });
  return result;
}

// Deep-validates and converts the "HH:MM" schedule the API accepts into the stored minutes
// form (see utils/openingHours.js) — the single place this happens, for both create and update.
function applyOpeningHours(data) {
  if (data.openingHours === undefined) return data;
  const { slots, error } = normalizeSlots(data.openingHours);
  if (error) throw ApiError.badRequest(error);
  return { ...data, openingHours: slots };
}

// Sets `<field>PublicId` alongside every image field present in `data`, derived
// from the URL itself — the one place this happens for the plain create/PATCH
// path (the dedicated upload endpoints below set it directly from Cloudinary's
// own response instead, which is even more reliable than re-parsing a URL).
function withDerivedPublicIds(data) {
  const result = { ...data };
  IMAGE_FIELDS.forEach((field) => {
    if (data[field] !== undefined) result[`${field}PublicId`] = derivePublicId(data[field]);
  });
  return result;
}

async function createRestaurant(owner, payload) {
  const data = withDerivedPublicIds(applyOpeningHours(pickFields(payload, CREATE_FIELDS)));
  return Restaurant.create({
    ...data,
    owner: owner._id,
    isApproved: false, // every new restaurant starts pending admin approval
    isActive: true,
  });
}

// Best-effort removal of an old asset once it's been safely replaced in the DB —
// prefers the reliably-stored publicId (works no matter who originally uploaded
// it); a record that predates M13 (publicId not yet backfilled) falls back to the
// same URL-ownership heuristic the system always used (see storage.service.js).
async function cleanupOldImage(oldUrl, oldPublicId, newUrl, ownerId) {
  if (!oldUrl || oldUrl === newUrl) return;
  if (oldPublicId) await storageService.deleteByPublicId(oldPublicId);
  else await storageService.deleteIfOwned(oldUrl, ownerId);
}

async function updateRestaurant(id, requester, payload) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only modify your own restaurant');

  const data = withDerivedPublicIds(applyOpeningHours(pickFields(payload, UPDATE_FIELDS)));
  const previous = {};
  IMAGE_FIELDS.forEach((field) => {
    previous[field] = { url: restaurant[field], publicId: restaurant[`${field}PublicId`] };
  });
  Object.assign(restaurant, data);
  await restaurant.save();

  // Only after the save succeeded: remove Cloudinary images that were just replaced.
  await Promise.all(
    IMAGE_FIELDS.map((field) => cleanupOldImage(previous[field].url, previous[field].publicId, restaurant[field], restaurant.owner))
  );
  return restaurant;
}

// M13 — a dedicated one-request "upload and attach" endpoint per image slot
// (logo/coverImage/image), reusing the exact same validated multipart upload
// (uploadSingleImage middleware) the rest of the app already uses. Safety order
// matches Part 11 exactly: upload the new asset (fails loudly, nothing touched
// yet, old image untouched) -> persist it -> only THEN remove the old one.
async function uploadRestaurantImage(id, type, requester, file) {
  if (!IMAGE_FIELDS.includes(type)) throw ApiError.badRequest(`type must be one of: ${IMAGE_FIELDS.join(', ')}`);
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only modify your own restaurant');

  const { url, publicId } = await storageService.saveUploadedFile(file, { purpose: 'restaurant', userId: requester._id.toString() });

  const previousUrl = restaurant[type];
  const previousPublicId = restaurant[`${type}PublicId`];
  restaurant[type] = url;
  restaurant[`${type}PublicId`] = publicId || null;
  await restaurant.save();

  await cleanupOldImage(previousUrl, previousPublicId, url, restaurant.owner);
  return restaurant;
}

// M13 — Part 12's delete flow: verify authorization, read the stored id, delete
// the Cloudinary asset, and ONLY THEN update MongoDB. A genuine Cloudinary
// failure (network/auth — see storage.service.js#deleteByPublicId) refuses the
// request rather than pretending the image is gone. The one documented,
// unavoidable exception: a record from before M13 with no stored publicId falls
// back to the best-effort URL-ownership heuristic, whose result can't reliably
// distinguish "genuinely failed" from "not one of ours to delete" — in that one
// legacy case only, the field is still cleared either way (Part 13: an
// unavoidable edge case of a design that didn't track publicId until now).
async function deleteRestaurantImage(id, type, requester) {
  if (!IMAGE_FIELDS.includes(type)) throw ApiError.badRequest(`type must be one of: ${IMAGE_FIELDS.join(', ')}`);
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only modify your own restaurant');

  const currentUrl = restaurant[type];
  if (!currentUrl) throw ApiError.badRequest(`This restaurant has no ${type} to delete`);
  const currentPublicId = restaurant[`${type}PublicId`];

  if (currentPublicId) {
    const result = await storageService.deleteByPublicId(currentPublicId);
    if (!result.success) throw new ApiError(502, 'Could not delete the image. Please try again.');
  } else {
    await storageService.deleteIfOwned(currentUrl, restaurant.owner);
  }

  restaurant[type] = '';
  restaurant[`${type}PublicId`] = null;
  await restaurant.save();
  return restaurant;
}

function assertKycTransition(restaurant, nextStatus) {
  const allowed = RESTAURANT_KYC_TRANSITIONS[restaurant.kycStatus] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(`Cannot move a restaurant's KYC from "${restaurant.kycStatus}" to "${nextStatus}"`);
  }
}

// M14 — the owner (or an admin on their behalf) submits the business-verification
// documents a reviewer needs. Explicit allow-list transition (NOT_SUBMITTED ->
// SUBMITTED, or REJECTED -> SUBMITTED to fix and resubmit, or VERIFIED ->
// SUBMITTED e.g. to renew an expired licence) — never a raw status write. Never
// touches isApproved/isActive: a restaurant that was already live stays live
// while its paperwork is under a fresh review (see the model's own comment).
async function submitKyc(id, requester, payload) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only submit KYC for your own restaurant');
  assertKycTransition(restaurant, RESTAURANT_KYC_STATUS.SUBMITTED);

  restaurant.kycDocuments = {
    fssaiLicenseNumber: payload.fssaiLicenseNumber,
    fssaiCertificateUrl: payload.fssaiCertificateUrl,
    panNumber: payload.panNumber,
    panCardUrl: payload.panCardUrl,
    gstNumber: payload.gstNumber || '',
    gstCertificateUrl: payload.gstCertificateUrl || '',
    ownerIdentityProofUrl: payload.ownerIdentityProofUrl,
  };
  restaurant.kycStatus = RESTAURANT_KYC_STATUS.SUBMITTED;
  restaurant.kycSubmittedAt = new Date();
  restaurant.kycRejectionReason = null;
  await restaurant.save();

  // Nobody is assigned yet — every admin who can approve restaurants is told a
  // submission needs review, never every admin (Part 16-style rule reused from M11/M12).
  await notificationService.notifyStaff(PERMISSIONS.RESTAURANTS_APPROVE, {
    type: NOTIFICATION_TYPE.RESTAURANT_KYC_SUBMITTED,
    data: { restaurantId: restaurant._id, restaurantName: restaurant.name },
    entityId: restaurant._id,
  });

  return restaurant;
}

// Soft delete: flips isActive off instead of removing the document, so existing
// orders/reviews that reference this restaurant stay intact and queryable.
async function deactivateRestaurant(id, requester) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only modify your own restaurant');

  restaurant.isActive = false;
  await restaurant.save();
  return restaurant;
}

module.exports = {
  listPublicRestaurants,
  listMyRestaurants,
  getRestaurantById,
  createRestaurant,
  updateRestaurant,
  deactivateRestaurant,
  uploadRestaurantImage,
  deleteRestaurantImage,
  submitKyc,
  canView,
  isPubliclyVisible,
  IMAGE_FIELDS,
};
