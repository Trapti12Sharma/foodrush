const FoodItem = require('../models/FoodItem');
const FoodCategory = require('../models/FoodCategory');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { assertOwnerOrAdmin } = require('../utils/ownership');
const restaurantService = require('./restaurant.service');
const { ROLES } = require('../utils/constants');

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
];
const UPDATE_FIELDS = [...CREATE_FIELDS, 'isAvailable', 'category'];

async function listFoods(query, requester) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};

  if (query.restaurant) {
    const restaurant = await restaurantService.getRestaurantById(query.restaurant, requester);
    const isManager =
      requester && (requester.role === ROLES.ADMIN || restaurant.owner.toString() === requester._id.toString());

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
  Object.assign(food, data);
  await food.save();
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
}

module.exports = { listFoods, getFoodById, createFood, updateFood, deleteFood };
