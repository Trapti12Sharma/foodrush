const Cart = require('../models/Cart');
const FoodItem = require('../models/FoodItem');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');

const TAX_RATE = 0.05; // flat 5% — a real deployment would vary this by jurisdiction/item

async function getOrCreateCart(userId) {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) cart = await Cart.create({ user: userId, items: [] });
  return cart;
}

function addonKey(addons) {
  return addons
    .map((a) => `${a.name}:${a.price}`)
    .sort()
    .join('|');
}

// Runs on every read/write: drops items whose FoodItem was deleted or made
// unavailable since they were added, clears the cart entirely if its restaurant
// was disabled/deapproved, and always recomputes prices from the current
// FoodItem — never from the price snapshot stored on the cart line. This is the
// same "never trust a stored/client price" rule from Phase 4, applied proactively
// here so the cart the customer sees is never stale.
async function syncAndRecalculate(cart) {
  if (cart.items.length === 0) {
    cart.restaurant = null;
    cart.subtotal = 0;
    cart.deliveryFee = 0;
    cart.tax = 0;
    cart.discount = 0;
    cart.total = 0;
    await cart.save();
    return cart;
  }

  const restaurant = await Restaurant.findById(cart.restaurant);
  const restaurantGone = !restaurant || !restaurant.isApproved || !restaurant.isActive;

  if (restaurantGone) {
    cart.items = [];
    cart.restaurant = null;
    cart.subtotal = 0;
    cart.deliveryFee = 0;
    cart.tax = 0;
    cart.discount = 0;
    cart.total = 0;
    await cart.save();
    return cart;
  }

  const foods = await FoodItem.find({ _id: { $in: cart.items.map((i) => i.food) } });
  const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

  cart.items = cart.items.filter((item) => {
    const food = foodMap.get(item.food.toString());
    if (!food || !food.isAvailable) return false;
    item.price = food.effectivePrice();
    return true;
  });

  if (cart.items.length === 0) cart.restaurant = null;

  const subtotal = cart.items.reduce((sum, item) => {
    const addonsTotal = item.addons.reduce((a, addon) => a + addon.price, 0);
    return sum + (item.price + addonsTotal) * item.quantity;
  }, 0);
  const deliveryFee = cart.items.length ? restaurant.deliveryFee : 0;
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const discount = cart.items.length ? cart.discount || 0 : 0;
  const total = Math.max(subtotal + deliveryFee + tax - discount, 0);

  Object.assign(cart, { subtotal, deliveryFee, tax, discount, total });
  await cart.save();
  return cart;
}

async function getCart(userId) {
  const cart = await getOrCreateCart(userId);
  return syncAndRecalculate(cart);
}

async function addItem(userId, { foodId, quantity = 1, addons = [] }) {
  if (quantity < 1) throw ApiError.badRequest('Quantity must be at least 1');

  const food = await FoodItem.findById(foodId);
  if (!food) throw ApiError.notFound('Food item not found');
  if (!food.isAvailable) throw ApiError.badRequest('This item is currently unavailable');

  const restaurant = await Restaurant.findById(food.restaurant);
  if (!restaurant || !restaurant.isApproved || !restaurant.isActive) {
    throw ApiError.notFound('Restaurant not found');
  }

  // Validate every requested addon against the food's own addon list — price
  // always comes from that match, never from what the client sent.
  const validatedAddons = addons.map((requested) => {
    const match = food.addons.find(
      (a) => a._id.toString() === requested.addonId || a.name === requested.name
    );
    if (!match || !match.isAvailable) {
      throw ApiError.badRequest(`Add-on "${requested.name || requested.addonId}" is not available for this item`);
    }
    return { name: match.name, price: match.price };
  });

  const cart = await getOrCreateCart(userId);

  if (cart.items.length > 0 && cart.restaurant && cart.restaurant.toString() !== restaurant._id.toString()) {
    const currentRestaurant = await Restaurant.findById(cart.restaurant);
    const conflict = ApiError.conflict(
      'Your cart has items from another restaurant. Clear your cart to order from this restaurant instead.'
    );
    conflict.data = {
      existingRestaurantId: cart.restaurant,
      existingRestaurantName: currentRestaurant?.name || 'another restaurant',
    };
    throw conflict;
  }

  cart.restaurant = restaurant._id;

  const existingLine = cart.items.find(
    (item) => item.food.toString() === food._id.toString() && addonKey(item.addons) === addonKey(validatedAddons)
  );
  if (existingLine) {
    existingLine.quantity += quantity;
  } else {
    cart.items.push({ food: food._id, quantity, price: food.effectivePrice(), addons: validatedAddons });
  }

  await cart.save();
  return syncAndRecalculate(cart);
}

async function updateItemQuantity(userId, itemId, quantity) {
  if (quantity < 1) throw ApiError.badRequest('Quantity must be at least 1');

  const cart = await getOrCreateCart(userId);
  const item = cart.items.id(itemId);
  if (!item) throw ApiError.notFound('Cart item not found');

  item.quantity = quantity;
  await cart.save();
  return syncAndRecalculate(cart);
}

async function removeItem(userId, itemId) {
  const cart = await getOrCreateCart(userId);
  const item = cart.items.id(itemId);
  if (!item) throw ApiError.notFound('Cart item not found');

  item.deleteOne();
  await cart.save();
  return syncAndRecalculate(cart);
}

async function clearCart(userId) {
  const cart = await getOrCreateCart(userId);
  cart.items = [];
  cart.restaurant = null;
  cart.discount = 0;
  await cart.save();
  return syncAndRecalculate(cart);
}

module.exports = { getCart, addItem, updateItemQuantity, removeItem, clearCart };
