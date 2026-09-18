const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { assertOwnerOrAdmin } = require('../utils/ownership');
const { ROLES } = require('../utils/constants');

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
  'cuisine',
  'address',
  'city',
  'location',
  'deliveryTime',
  'deliveryFee',
  'minimumOrder',
];

const UPDATE_FIELDS = [...CREATE_FIELDS, 'isOpen'];

function isPubliclyVisible(restaurant) {
  return restaurant.isApproved && restaurant.isActive;
}

// A restaurant not yet approved (or disabled by an admin) is invisible to the
// public — only its owner or an admin can see it, e.g. while it's pending review.
function canView(restaurant, requester) {
  if (isPubliclyVisible(restaurant)) return true;
  if (!requester) return false;
  return requester.role === ROLES.ADMIN || restaurant.owner.toString() === requester._id.toString();
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

async function createRestaurant(owner, payload) {
  const data = pickFields(payload, CREATE_FIELDS);
  return Restaurant.create({
    ...data,
    owner: owner._id,
    isApproved: false, // every new restaurant starts pending admin approval
    isActive: true,
  });
}

async function updateRestaurant(id, requester, payload) {
  const restaurant = await Restaurant.findById(id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only modify your own restaurant');

  const data = pickFields(payload, UPDATE_FIELDS);
  Object.assign(restaurant, data);
  await restaurant.save();
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
  canView,
  isPubliclyVisible,
};
