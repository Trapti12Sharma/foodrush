const Cart = require('../models/Cart');
const FoodItem = require('../models/FoodItem');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const couponService = require('./coupon.service');

const TAX_RATE = 0.05; // flat 5% — a real deployment would vary this by jurisdiction/item

const POPULATE_PATHS = [
  { path: 'items.food', select: 'name image isVeg' },
  { path: 'restaurant', select: 'name image isOpen deliveryFee minimumOrder' },
];

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

// Drops items whose FoodItem was deleted/made unavailable, recomputes every
// price from the current FoodItem (never from the stored snapshot), re-validates
// any applied coupon against the fresh subtotal (silently dropping it if it no
// longer qualifies), and clears the restaurant lock once the cart is empty.
// Mutates `cart` in place; does NOT save or populate — callers do that once,
// after any additional mutation of their own (e.g. applying a coupon), so a
// populated document is never accidentally re-saved.
async function recalculate(cart) {
  if (cart.items.length > 0) {
    const restaurant = await Restaurant.findById(cart.restaurant);
    const restaurantGone = !restaurant || !restaurant.isApproved || !restaurant.isActive;
    if (restaurantGone) cart.items = [];
    else await applyCatalogPricing(cart, restaurant);
  }

  if (cart.items.length === 0) {
    cart.restaurant = null;
    cart.couponCode = null;
    cart.subtotal = 0;
    cart.deliveryFee = 0;
    cart.tax = 0;
    cart.discount = 0;
    cart.total = 0;
  }

  return cart;
}

async function applyCatalogPricing(cart, restaurant) {
  const foods = await FoodItem.find({ _id: { $in: cart.items.map((i) => i.food) } });
  const foodMap = new Map(foods.map((f) => [f._id.toString(), f]));

  cart.items = cart.items.filter((item) => {
    const food = foodMap.get(item.food.toString());
    if (!food || !food.isAvailable) return false;
    item.price = food.effectivePrice();
    return true;
  });

  if (cart.items.length === 0) return; // recalculate() zeroes totals and clears the restaurant lock

  const subtotal = cart.items.reduce((sum, item) => {
    const addonsTotal = item.addons.reduce((a, addon) => a + addon.price, 0);
    return sum + (item.price + addonsTotal) * item.quantity;
  }, 0);

  let discount = 0;
  if (cart.couponCode) {
    const result = await couponService.validateCoupon(cart.couponCode, subtotal).catch(() => null);
    if (result) discount = result.discountAmount;
    else cart.couponCode = null; // coupon no longer valid for this cart — drop it rather than show a stale discount
  }

  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = Math.max(subtotal + restaurant.deliveryFee + tax - discount, 0);

  Object.assign(cart, { subtotal, deliveryFee: restaurant.deliveryFee, tax, discount, total });
}

async function finalize(cart) {
  await cart.save();
  // Display-only: names/images for the frontend. Price is never read from this —
  // it's already been set on each item from FoodItem.effectivePrice() above.
  await cart.populate(POPULATE_PATHS);
  return cart;
}

async function getCart(userId) {
  const cart = await getOrCreateCart(userId);
  await recalculate(cart);
  return finalize(cart);
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

  await recalculate(cart);
  return finalize(cart);
}

async function updateItemQuantity(userId, itemId, quantity) {
  if (quantity < 1) throw ApiError.badRequest('Quantity must be at least 1');

  const cart = await getOrCreateCart(userId);
  const item = cart.items.id(itemId);
  if (!item) throw ApiError.notFound('Cart item not found');

  item.quantity = quantity;
  await recalculate(cart);
  return finalize(cart);
}

async function removeItem(userId, itemId) {
  const cart = await getOrCreateCart(userId);
  const item = cart.items.id(itemId);
  if (!item) throw ApiError.notFound('Cart item not found');

  item.deleteOne();
  await recalculate(cart);
  return finalize(cart);
}

async function clearCart(userId) {
  const cart = await getOrCreateCart(userId);
  cart.items = [];
  cart.restaurant = null;
  cart.couponCode = null;
  cart.discount = 0;
  await recalculate(cart);
  return finalize(cart);
}

async function applyCoupon(userId, code) {
  if (!code || !code.trim()) throw ApiError.badRequest('Coupon code is required');

  const cart = await getOrCreateCart(userId);
  if (cart.items.length === 0) throw ApiError.badRequest('Your cart is empty');

  // Refresh pricing first so the coupon is validated against a genuinely current subtotal.
  cart.couponCode = null;
  await recalculate(cart);

  const { coupon, discountAmount } = await couponService.validateCoupon(code, cart.subtotal);
  cart.couponCode = coupon.code;
  cart.discount = discountAmount;
  cart.total = Math.max(cart.subtotal + cart.deliveryFee + cart.tax - discountAmount, 0);

  return finalize(cart);
}

async function removeCoupon(userId) {
  const cart = await getOrCreateCart(userId);
  cart.couponCode = null;
  await recalculate(cart);
  return finalize(cart);
}

module.exports = {
  getCart,
  addItem,
  updateItemQuantity,
  removeItem,
  clearCart,
  applyCoupon,
  removeCoupon,
};
