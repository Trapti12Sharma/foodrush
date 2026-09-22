const Cart = require('../models/Cart');
const FoodItem = require('../models/FoodItem');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const couponService = require('./coupon.service');
const pricing = require('./pricing.service');
const { MAX_NOTE_LENGTH } = require('../validators/cart.validator');

const POPULATE_PATHS = [
  { path: 'items.food', select: 'name image isVeg' },
  // openingHours/timezone are included so the isOpenNow virtual (used by the frontend to
  // warn "this restaurant is closed" before checkout) reflects the real schedule, not just
  // the manual isOpen switch.
  { path: 'restaurant', select: 'name image isOpen openingHours timezone deliveryFee minimumOrder' },
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

// Two lines for the same food are the same cart line only if their add-ons, chosen
// variant AND note all match — a different note (e.g. "no onions") is deliberately kept
// as its own line rather than merged into one with an ambiguous instruction.
function lineKey(item) {
  return `${addonKey(item.addons)}::${item.variantId || ''}::${item.note || ''}`;
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
    // The catalog changed under this line (variants added/removed since it was added, or
    // the chosen variant/no-longer-exists) — safest to drop it rather than guess a price.
    const hasVariants = food.variants && food.variants.length > 0;
    if (Boolean(item.variantId) !== hasVariants) return false;
    const price = pricing.unitPriceFor(food, item.variantId);
    if (price == null) return false;
    item.price = price;
    return true;
  });

  if (cart.items.length === 0) return; // recalculate() zeroes totals and clears the restaurant lock

  const subtotal = pricing.subtotalOf(cart.items);

  let discount = 0;
  if (cart.couponCode) {
    const result = await couponService.validateCoupon(cart.couponCode, subtotal).catch(() => null);
    if (result) discount = result.discountAmount;
    else cart.couponCode = null; // coupon no longer valid for this cart — drop it rather than show a stale discount
  }

  Object.assign(cart, pricing.computeTotals({ subtotal, deliveryFee: restaurant.deliveryFee, discount }));
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

async function addItem(userId, { foodId, quantity = 1, addons = [], variantId, note }) {
  if (quantity < 1) throw ApiError.badRequest('Quantity must be at least 1');

  const food = await FoodItem.findById(foodId);
  if (!food) throw ApiError.notFound('Food item not found');
  if (!food.isAvailable) throw ApiError.badRequest('This item is currently unavailable');

  const restaurant = await Restaurant.findById(food.restaurant);
  if (!restaurant || !restaurant.isApproved || !restaurant.isActive) {
    throw ApiError.notFound('Restaurant not found');
  }

  const hasVariants = food.variants && food.variants.length > 0;
  let variant = null;
  if (hasVariants) {
    if (!variantId) throw ApiError.badRequest('Please choose an option (e.g. size) for this item');
    variant = food.variants.id(variantId);
    if (!variant || !variant.isAvailable) throw ApiError.badRequest('That option is currently unavailable');
  } else if (variantId) {
    throw ApiError.badRequest('This item does not have selectable options');
  }
  const unitPrice = pricing.unitPriceFor(food, variantId);
  const normalizedNote = (note || '').trim().slice(0, MAX_NOTE_LENGTH);

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

  const candidate = { addons: validatedAddons, variantId: variantId || null, note: normalizedNote };
  const existingLine = cart.items.find((item) => item.food.toString() === food._id.toString() && lineKey(item) === lineKey(candidate));
  if (existingLine) {
    existingLine.quantity += quantity;
  } else {
    cart.items.push({
      food: food._id, quantity, price: unitPrice, addons: validatedAddons,
      variantId: variantId || null, variantName: variant ? variant.name : null, note: normalizedNote,
    });
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
  cart.total = pricing.computeTotals({
    subtotal: cart.subtotal,
    deliveryFee: cart.deliveryFee,
    discount: discountAmount,
  }).total;

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
