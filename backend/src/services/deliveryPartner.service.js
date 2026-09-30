const DeliveryPartner = require('../models/DeliveryPartner');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { DELIVERY_KYC_STATUS, DELIVERY_ACCOUNT_STATUS, DELIVERY_AVAILABILITY } = require('../utils/constants');

const CREATE_FIELDS = [
  'fullName',
  'phone',
  'dateOfBirth',
  'address',
  'city',
  'vehicleType',
  'vehicleNumber',
  'drivingLicenceNumber',
  'drivingLicenceExpiry',
  'documents',
  'emergencyContact',
];

// Same set may be edited later. Deliberately excludes kycStatus, accountStatus,
// accountStatusReason, kycRejectionReason, kycReviewedAt/By, availability and
// currentLocation — those are either admin-only (state machine below) or have
// their own dedicated endpoints. Even if a client sends those fields here, they
// are silently dropped, never applied — the same convention restaurant.service.js
// uses for isApproved/isActive.
const UPDATE_FIELDS = CREATE_FIELDS;

// Fields hidden from the admin LIST endpoint (bulk view) — only the single-partner
// detail endpoint returns them. "Do not expose sensitive KYC information in normal
// list APIs."
const LIST_HIDDEN_FIELDS = '-documents -drivingLicenceNumber -dateOfBirth -emergencyContact';

function pickFields(source, fields) {
  const result = {};
  fields.forEach((field) => {
    if (source[field] !== undefined) result[field] = source[field];
  });
  return result;
}

async function createProfile(user, payload) {
  const existing = await DeliveryPartner.findOne({ user: user._id });
  if (existing) throw ApiError.conflict('You already have a delivery partner profile');

  const data = pickFields(payload, CREATE_FIELDS);

  // Seed the rider's position from sign-up when they gave us one. currentLocation
  // is not in CREATE_FIELDS (clients must not be able to set arbitrary geo state
  // through the generic field-pick), so it is built explicitly here from the
  // validated latitude/longitude. Live sharing later overwrites it; until then
  // this is what makes a brand-new rider visible to dispatch at all.
  const { latitude, longitude } = payload;
  const hasStartingPoint = typeof latitude === 'number' && typeof longitude === 'number';

  return DeliveryPartner.create({
    ...data,
    ...(hasStartingPoint
      ? { currentLocation: { type: 'Point', coordinates: [longitude, latitude] }, lastLocationAt: new Date() }
      : {}),
    user: user._id,
    // The create validator requires every document a reviewer needs for this
    // vehicle type, so a successful create always represents a complete
    // submission — never a partial/draft one. See constants.js DELIVERY_KYC_STATUS
    // for why PENDING still exists as a value even though it isn't reachable here.
    kycStatus: DELIVERY_KYC_STATUS.SUBMITTED,
    accountStatus: DELIVERY_ACCOUNT_STATUS.PENDING,
  });
}

async function getMyProfile(user) {
  const partner = await DeliveryPartner.findOne({ user: user._id });
  if (!partner) throw ApiError.notFound('You have not set up a delivery partner profile yet');
  return partner;
}

async function updateMyProfile(user, payload) {
  const partner = await getMyProfile(user);
  const data = pickFields(payload, UPDATE_FIELDS);
  // Merged, not replaced: a partial update (e.g. re-uploading just one document
  // after a rejection) must not silently wipe out the other documents already on
  // file — each of those required a real upload to obtain.
  if (data.documents) data.documents = { ...partner.documents?.toObject?.(), ...data.documents };
  Object.assign(partner, data);
  await partner.save();
  return partner;
}

// Server-side validated: a client can request ONLINE, but only an ACTIVE,
// KYC-VERIFIED partner is actually allowed to become reachable for delivery —
// checked fresh on every call, never cached from an earlier state.
async function setAvailability(user, availability) {
  const partner = await getMyProfile(user);
  if (availability === DELIVERY_AVAILABILITY.ONLINE) {
    if (partner.accountStatus !== DELIVERY_ACCOUNT_STATUS.ACTIVE || partner.kycStatus !== DELIVERY_KYC_STATUS.VERIFIED) {
      throw ApiError.badRequest('Only an active, KYC-verified delivery partner can go online');
    }
  }
  partner.availability = availability;
  await partner.save();
  return partner;
}

// Foundation only — stores a real device fix as reported by the client. No
// fake/random coordinates are ever generated here. Real-time broadcast (Socket.IO)
// and dispatch use of this are later milestones; this just persists the latest
// known point.
async function updateMyLocation(user, { latitude, longitude, accuracy }) {
  const partner = await getMyProfile(user);
  partner.currentLocation = { type: 'Point', coordinates: [Number(longitude), Number(latitude)] };
  partner.locationAccuracyMeters = accuracy !== undefined && accuracy !== null ? Number(accuracy) : null;
  partner.lastLocationAt = new Date();
  await partner.save();
  return partner;
}

async function listForAdmin(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.kycStatus) filter.kycStatus = query.kycStatus;
  if (query.accountStatus) filter.accountStatus = query.accountStatus;
  if (query.city) filter.city = new RegExp(`^${escapeRegex(query.city)}$`, 'i');
  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ fullName: re }, { phone: re }, { vehicleNumber: re }];
  }

  const [items, total] = await Promise.all([
    DeliveryPartner.find(filter)
      .select(LIST_HIDDEN_FIELDS)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email isActive'),
    DeliveryPartner.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getByIdForAdmin(id) {
  const partner = await DeliveryPartner.findById(id)
    .populate('user', 'name email isActive')
    .populate('kycReviewedBy', 'name email');
  if (!partner) throw ApiError.notFound('Delivery partner not found');
  return partner;
}

async function approveKyc(id, admin) {
  const partner = await DeliveryPartner.findById(id);
  if (!partner) throw ApiError.notFound('Delivery partner not found');
  if (partner.kycStatus !== DELIVERY_KYC_STATUS.SUBMITTED) {
    throw ApiError.badRequest(`Cannot approve KYC from status "${partner.kycStatus}"`);
  }
  partner.kycStatus = DELIVERY_KYC_STATUS.VERIFIED;
  partner.accountStatus = DELIVERY_ACCOUNT_STATUS.ACTIVE;
  partner.kycRejectionReason = null;
  partner.kycReviewedAt = new Date();
  partner.kycReviewedBy = admin._id;
  await partner.save();
  return partner;
}

async function rejectKyc(id, admin, reason) {
  const partner = await DeliveryPartner.findById(id);
  if (!partner) throw ApiError.notFound('Delivery partner not found');
  if (partner.kycStatus !== DELIVERY_KYC_STATUS.SUBMITTED) {
    throw ApiError.badRequest(`Cannot reject KYC from status "${partner.kycStatus}"`);
  }
  partner.kycStatus = DELIVERY_KYC_STATUS.REJECTED;
  partner.accountStatus = DELIVERY_ACCOUNT_STATUS.REJECTED;
  partner.kycRejectionReason = reason;
  partner.kycReviewedAt = new Date();
  partner.kycReviewedBy = admin._id;
  await partner.save();
  return partner;
}

async function suspend(id, reason) {
  const partner = await DeliveryPartner.findById(id);
  if (!partner) throw ApiError.notFound('Delivery partner not found');
  if (partner.accountStatus !== DELIVERY_ACCOUNT_STATUS.ACTIVE) {
    throw ApiError.badRequest(`Only an active delivery partner can be suspended (current status: "${partner.accountStatus}")`);
  }
  partner.accountStatus = DELIVERY_ACCOUNT_STATUS.SUSPENDED;
  partner.accountStatusReason = reason || null;
  // A suspended partner must never remain reachable for a new order.
  partner.availability = DELIVERY_AVAILABILITY.OFFLINE;
  await partner.save();
  return partner;
}

async function reactivate(id) {
  const partner = await DeliveryPartner.findById(id);
  if (!partner) throw ApiError.notFound('Delivery partner not found');
  if (partner.accountStatus !== DELIVERY_ACCOUNT_STATUS.SUSPENDED) {
    throw ApiError.badRequest(`Only a suspended delivery partner can be reactivated (current status: "${partner.accountStatus}")`);
  }
  if (partner.kycStatus !== DELIVERY_KYC_STATUS.VERIFIED) {
    throw ApiError.badRequest('Cannot reactivate a delivery partner whose KYC is not verified');
  }
  partner.accountStatus = DELIVERY_ACCOUNT_STATUS.ACTIVE;
  partner.accountStatusReason = null;
  await partner.save();
  return partner;
}

module.exports = {
  createProfile,
  getMyProfile,
  updateMyProfile,
  setAvailability,
  updateMyLocation,
  listForAdmin,
  getByIdForAdmin,
  approveKyc,
  rejectKyc,
  suspend,
  reactivate,
};
