const FoodItem = require('../models/FoodItem');
const FoodCategory = require('../models/FoodCategory');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { assertOwnerOrAdmin } = require('../utils/ownership');
const restaurantService = require('./restaurant.service');
const storageService = require('./storage.service');
const { parseCloudinaryUrl } = require('../utils/imageUrl');
const { PERMISSIONS, hasPermission } = require('../utils/permissions');

// Same reasoning as restaurant.service.js's identical helper: always
// server-derived from the URL, never a client-settable field.
function derivePublicId(url) {
  return parseCloudinaryUrl(url)?.publicId || null;
}

// Mirrors restaurant.service.js#cleanupOldImage exactly — prefer the reliably
// stored publicId; a pre-M13 record without one falls back to the URL-ownership heuristic.
async function cleanupOldImage(oldUrl, oldPublicId, newUrl, ownerId) {
  if (!oldUrl || oldUrl === newUrl) return;
  if (oldPublicId) await storageService.deleteByPublicId(oldPublicId);
  else await storageService.deleteIfOwned(oldUrl, ownerId);
}

const SORT_MAP = {
  price_asc: 'price',
  price_desc: '-price',
  name: 'name',
  newest: '-createdAt',
};

const CREATE_FIELDS = [
  'name',
  'description',
  'image',
  'price',
  'discountPrice',
  'isVeg',
  'preparationTime',
  'addons',
  'variants',
  'isRecommended',
  'isBestseller',
];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'isAvailable', 'category'];

async function listFoods(query, requester) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};

  if (query.restaurant) {
    const restaurant = await restaurantService.getRestaurantById(query.restaurant, requester);
    const isManager =
      requester &&
      (hasPermission(requester, PERMISSIONS.RESTAURANTS_READ_ALL) || restaurant.owner.toString() === requester._id.toString());

    filter.restaurant = restaurant._id;
    if (!isManager) filter.isAvailable = true;
  } else {
    // Platform-wide search: only surface items belonging to publicly visible restaurants.
    const publicRestaurantIds = await Restaurant.find({ isApproved: true, isActive: true }).distinct('_id');
    filter.restaurant = { $in: publicRestaurantIds };
    filter.isAvailable = true;
  }

  if (query.category) filter.category = query.category;

  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [{ name: re }, { description: re }];
  }

  if (query.isVeg === 'true') filter.isVeg = true;
  if (query.isVeg === 'false') filter.isVeg = false;
  if (query.hasOffer === 'true') filter.discountPrice = { $ne: null };

  if (query.minPrice || query.maxPrice) {
    filter.price = {};
    if (query.minPrice) filter.price.$gte = Number(query.minPrice);
    if (query.maxPrice) filter.price.$lte = Number(query.maxPrice);
  }

  const sort = SORT_MAP[query.sort] || '-createdAt';

  const [items, total] = await Promise.all([
    FoodItem.find(filter).sort(sort).skip(skip).limit(limit).populate('category', 'name'),
    FoodItem.countDocuments(filter),
  ]);

  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getFoodById(id, requester) {
  const food = await FoodItem.findById(id).populate('category', 'name');
  if (!food) throw ApiError.notFound('Food item not found');

  // Reuses the restaurant visibility rule so a hidden restaurant's menu can't be
  // browsed item-by-item even if someone has (or guesses) a direct food item id.
  await restaurantService.getRestaurantById(food.restaurant, requester);
  return food;
}

async function validateCategoryBelongsToRestaurant(categoryId, restaurantId) {
  const category = await FoodCategory.findById(categoryId);
  if (!category || category.restaurant.toString() !== restaurantId.toString()) {
    throw ApiError.badRequest('Category does not belong to this restaurant');
  }
  return category;
}

function pickFields(source, fields) {
  const result = {};
  fields.forEach((field) => {
    if (source[field] !== undefined) result[field] = source[field];
  });
  return result;
}

async function createFood(requester, payload) {
  const restaurant = await Restaurant.findById(payload.restaurant);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  await validateCategoryBelongsToRestaurant(payload.category, restaurant._id);

  const data = pickFields(payload, CREATE_FIELDS);
  if (data.image !== undefined) data.imagePublicId = derivePublicId(data.image);
  return FoodItem.create({ ...data, restaurant: restaurant._id, category: payload.category });
}

async function updateFood(id, requester, payload) {
  const food = await FoodItem.findById(id);
  if (!food) throw ApiError.notFound('Food item not found');

  const restaurant = await Restaurant.findById(food.restaurant);
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  if (payload.category) {
    await validateCategoryBelongsToRestaurant(payload.category, restaurant._id);
  }

  const data = pickFields(payload, UPDATE_FIELDS);
  if (data.image !== undefined) data.imagePublicId = derivePublicId(data.image);
  const previousImage = food.image;
  const previousPublicId = food.imagePublicId;
  Object.assign(food, data);
  await food.save();
  await cleanupOldImage(previousImage, previousPublicId, food.image, restaurant.owner);
  return food;
}

// Hard delete is safe for order history: Order.items stores a frozen snapshot
// (name/price copied at purchase time), not a live reference, so past orders are
// unaffected. Any cart still holding this item is reconciled at checkout time
// (Phase 6/8), where the cart/order service re-fetches each FoodItem and drops
// items that no longer exist.
async function deleteFood(id, requester) {
  const food = await FoodItem.findById(id);
  if (!food) throw ApiError.notFound('Food item not found');

  const restaurant = await Restaurant.findById(food.restaurant);
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  await food.deleteOne();
  if (food.imagePublicId) await storageService.deleteByPublicId(food.imagePublicId);
  else await storageService.deleteIfOwned(food.image, restaurant.owner);
}

// M13 — the dedicated one-request "upload and attach" endpoint, mirroring
// restaurant.service.js#uploadRestaurantImage exactly: upload first (old image
// untouched if this fails), persist, only then clean up the old asset.
async function uploadFoodImage(id, requester, file) {
  const food = await FoodItem.findById(id);
  if (!food) throw ApiError.notFound('Food item not found');
  const restaurant = await Restaurant.findById(food.restaurant);
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  const { url, publicId } = await storageService.saveUploadedFile(file, { purpose: 'food', userId: requester._id.toString() });

  const previousImage = food.image;
  const previousPublicId = food.imagePublicId;
  food.image = url;
  food.imagePublicId = publicId || null;
  await food.save();

  await cleanupOldImage(previousImage, previousPublicId, url, restaurant.owner);
  return food;
}

// M13 — mirrors restaurant.service.js#deleteRestaurantImage's delete-flow and
// legacy-fallback behavior exactly (see its comment for the one documented edge case).
async function deleteFoodImage(id, requester) {
  const food = await FoodItem.findById(id);
  if (!food) throw ApiError.notFound('Food item not found');
  const restaurant = await Restaurant.findById(food.restaurant);
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  if (!food.image) throw ApiError.badRequest('This food item has no image to delete');

  if (food.imagePublicId) {
    const result = await storageService.deleteByPublicId(food.imagePublicId);
    if (!result.success) throw new ApiError(502, 'Could not delete the image. Please try again.');
  } else {
    await storageService.deleteIfOwned(food.image, restaurant.owner);
  }

  food.image = '';
  food.imagePublicId = null;
  await food.save();
  return food;
}

module.exports = { listFoods, getFoodById, createFood, updateFood, deleteFood, uploadFoodImage, deleteFoodImage };
