const FoodCategory = require('../models/FoodCategory');
const FoodItem = require('../models/FoodItem');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { assertOwnerOrAdmin } = require('../utils/ownership');
const restaurantService = require('./restaurant.service');

async function listByRestaurant(restaurantId, requester) {
  const restaurant = await restaurantService.getRestaurantById(restaurantId, requester);
  const isManager =
    requester &&
    (requester.role === 'ADMIN' || restaurant.owner.toString() === requester._id.toString());

  const filter = { restaurant: restaurant._id };
  if (!isManager) filter.isActive = true; // customers only see enabled categories

  return FoodCategory.find(filter).sort('name');
}

async function getCategoryById(id) {
  const category = await FoodCategory.findById(id);
  if (!category) throw ApiError.notFound('Category not found');
  return category;
}

async function createCategory(requester, { restaurant: restaurantId, name, description, image }) {
  const restaurant = await Restaurant.findById(restaurantId);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  const existing = await FoodCategory.findOne({ restaurant: restaurantId, name: name.trim() });
  if (existing) throw ApiError.conflict('A category with this name already exists for this restaurant');

  return FoodCategory.create({ restaurant: restaurantId, name, description, image });
}

async function updateCategory(id, requester, payload) {
  const category = await FoodCategory.findById(id);
  if (!category) throw ApiError.notFound('Category not found');

  const restaurant = await Restaurant.findById(category.restaurant);
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  ['name', 'description', 'image', 'isActive'].forEach((field) => {
    if (payload[field] !== undefined) category[field] = payload[field];
  });
  await category.save();
  return category;
}

async function deleteCategory(id, requester) {
  const category = await FoodCategory.findById(id);
  if (!category) throw ApiError.notFound('Category not found');

  const restaurant = await Restaurant.findById(category.restaurant);
  assertOwnerOrAdmin(restaurant.owner, requester, 'You can only manage your own restaurant');

  const itemCount = await FoodItem.countDocuments({ category: id });
  if (itemCount > 0) {
    throw ApiError.conflict(
      `Cannot delete a category that still has ${itemCount} food item(s). Move or delete them first.`
    );
  }

  await category.deleteOne();
}

module.exports = { listByRestaurant, getCategoryById, createCategory, updateCategory, deleteCategory };
