// Populates demo data for local development / a fresh deployment — three
// demo accounts (see the printed summary at the end), an approved restaurant
// with a real menu, a couple of orders (one delivered, with a review), and a
// coupon. Safe to re-run: every step upserts or checks-before-creating rather
// than blindly inserting duplicates.
//
// FOR LOCAL / DEV USE ONLY. Never point this at a database with real users —
// it creates an ADMIN account with a known password.
require('dotenv').config();
const mongoose = require('mongoose');

const { User, Address, Restaurant, FoodCategory, FoodItem, Order, Review, Coupon, Cart, Favorite } = require('../src/models');
const { ORDER_STATUS, ROLES } = require('../src/utils/constants');

const DEMO_PASSWORD = 'password123';

async function upsertUser({ name, email, role }) {
  let user = await User.findOne({ email });
  if (user) return user;
  user = await User.create({ name, email, password: DEMO_PASSWORD, role });
  return user;
}

async function upsertRestaurant(owner, data) {
  let restaurant = await Restaurant.findOne({ name: data.name });
  if (restaurant) return restaurant;
  restaurant = await Restaurant.create({ ...data, owner: owner._id, isApproved: true, isActive: true });
  return restaurant;
}

async function upsertCategory(restaurant, name) {
  let category = await FoodCategory.findOne({ restaurant: restaurant._id, name });
  if (category) return category;
  return FoodCategory.create({ restaurant: restaurant._id, name });
}

async function upsertFood(restaurant, category, data) {
  let food = await FoodItem.findOne({ restaurant: restaurant._id, name: data.name });
  if (food) return food;
  return FoodItem.create({ ...data, restaurant: restaurant._id, category: category._id });
}

async function upsertAddress(user, data) {
  let address = await Address.findOne({ user: user._id, addressLine: data.addressLine });
  if (address) return address;
  const isFirst = (await Address.countDocuments({ user: user._id })) === 0;
  return Address.create({ ...data, user: user._id, isDefault: isFirst });
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name} — seeding demo data...\n`);

  // --- Demo accounts ---
  const admin = await upsertUser({ name: 'Demo Admin', email: 'admin@example.com', role: ROLES.ADMIN });
  const owner = await upsertUser({ name: 'Demo Restaurant Owner', email: 'restaurant@example.com', role: ROLES.RESTAURANT_OWNER });
  const customer = await upsertUser({ name: 'Demo Customer', email: 'customer@example.com', role: ROLES.CUSTOMER });

  // --- Restaurant + menu ---
  const restaurant = await upsertRestaurant(owner, {
    name: 'Spice Route Kitchen',
    description: 'Authentic regional cuisine, cooked fresh to order.',
    cuisine: ['Indian', 'Biryani', 'Mughlai'],
    address: { addressLine: '221 MG Road', state: 'Maharashtra', pincode: '411001' },
    city: 'Pune',
    location: { type: 'Point', coordinates: [73.8567, 18.5204] },
    deliveryTime: 35,
    deliveryFee: 25,
    minimumOrder: 100,
  });

  const startersCategory = await upsertCategory(restaurant, 'Starters');
  const mainsCategory = await upsertCategory(restaurant, 'Mains');
  const dessertsCategory = await upsertCategory(restaurant, 'Desserts');

  const paneerTikka = await upsertFood(restaurant, startersCategory, {
    name: 'Paneer Tikka', description: 'Chargrilled cottage cheese marinated in spiced yogurt.',
    price: 220, isVeg: true, preparationTime: 15,
  });
  await upsertFood(restaurant, startersCategory, {
    name: 'Chicken Seekh Kebab', description: 'Minced chicken skewers with house spices.',
    price: 260, isVeg: false, preparationTime: 18,
  });
  await upsertFood(restaurant, mainsCategory, {
    name: 'Hyderabadi Chicken Biryani', description: 'Slow-cooked basmati rice with tender chicken and saffron.',
    price: 320, discountPrice: 280, isVeg: false, preparationTime: 30,
    addons: [{ name: 'Extra Raita', price: 30 }, { name: 'Boiled Egg', price: 20 }],
  });
  await upsertFood(restaurant, mainsCategory, {
    name: 'Veg Dum Biryani', description: 'Basmati rice layered with mixed vegetables and spices.',
    price: 260, isVeg: true, preparationTime: 25,
  });
  await upsertFood(restaurant, mainsCategory, {
    name: 'Butter Chicken', description: 'Classic tomato-butter gravy with tandoori chicken.',
    price: 300, isVeg: false, preparationTime: 25,
  });
  await upsertFood(restaurant, dessertsCategory, {
    name: 'Gulab Jamun', description: 'Warm milk-solid dumplings in cardamom syrup.',
    price: 120, isVeg: true, preparationTime: 5,
  });

  // --- Customer address ---
  const address = await upsertAddress(customer, {
    label: 'Home', addressLine: '14 Koregaon Park', city: 'Pune', state: 'Maharashtra', pincode: '411006',
  });

  // --- Coupon ---
  let coupon = await Coupon.findOne({ code: 'WELCOME10' });
  if (!coupon) {
    coupon = await Coupon.create({
      code: 'WELCOME10', description: 'Welcome discount for new customers',
      discountType: 'PERCENTAGE', discountValue: 10, minimumOrder: 150, maximumDiscount: 80,
      expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), isActive: true,
    });
  }

  // --- A delivered order with a review, and a pending order ---
  const existingOrders = await Order.countDocuments({ user: customer._id, restaurant: restaurant._id });
  if (existingOrders === 0) {
    const deliveredOrder = await Order.create({
      user: customer._id, restaurant: restaurant._id,
      items: [
        { food: paneerTikka._id, name: paneerTikka.name, price: paneerTikka.price, quantity: 2, addons: [] },
      ],
      deliveryAddress: { label: address.label, addressLine: address.addressLine, city: address.city, state: address.state, pincode: address.pincode },
      subtotal: 440, deliveryFee: 25, tax: 22, discount: 0, totalAmount: 487,
      paymentMethod: 'COD', paymentStatus: 'pending',
      orderStatus: ORDER_STATUS.DELIVERED,
      statusHistory: [
        { status: ORDER_STATUS.PENDING, changedBy: customer._id },
        { status: ORDER_STATUS.CONFIRMED, changedBy: owner._id },
        { status: ORDER_STATUS.PREPARING, changedBy: owner._id },
        { status: ORDER_STATUS.READY_FOR_PICKUP, changedBy: owner._id },
        { status: ORDER_STATUS.OUT_FOR_DELIVERY, changedBy: owner._id },
        { status: ORDER_STATUS.DELIVERED, changedBy: owner._id },
      ],
    });

    await Review.create({
      user: customer._id, restaurant: restaurant._id, order: deliveredOrder._id,
      rating: 5, comment: 'The Paneer Tikka was excellent — smoky and well spiced. Will order again!',
    });
    await Restaurant.findByIdAndUpdate(restaurant._id, { rating: 5, totalReviews: 1 });

    await Order.create({
      user: customer._id, restaurant: restaurant._id,
      items: [{ food: paneerTikka._id, name: paneerTikka.name, price: paneerTikka.price, quantity: 1, addons: [] }],
      deliveryAddress: { label: address.label, addressLine: address.addressLine, city: address.city, state: address.state, pincode: address.pincode },
      subtotal: 220, deliveryFee: 25, tax: 11, discount: 0, totalAmount: 256,
      paymentMethod: 'COD', paymentStatus: 'pending',
      orderStatus: ORDER_STATUS.PENDING,
      statusHistory: [{ status: ORDER_STATUS.PENDING, changedBy: customer._id }],
    });
  }

  // --- Favorite ---
  await Favorite.findOneAndUpdate(
    { user: customer._id, restaurant: restaurant._id },
    { user: customer._id, restaurant: restaurant._id },
    { upsert: true }
  );

  // Ensure the demo customer's cart starts empty regardless of prior runs.
  await Cart.deleteOne({ user: customer._id });

  console.log('Seed complete.\n');
  console.log('Demo accounts (all use the same password):');
  console.log(`  Admin:             ${admin.email}  /  ${DEMO_PASSWORD}`);
  console.log(`  Restaurant owner:  ${owner.email}  /  ${DEMO_PASSWORD}`);
  console.log(`  Customer:          ${customer.email}  /  ${DEMO_PASSWORD}`);
  console.log(`\nDemo restaurant: "${restaurant.name}" (approved, ${await FoodItem.countDocuments({ restaurant: restaurant._id })} menu items)`);
  console.log(`Demo coupon: WELCOME10 (10% off, min order 150, expires in 90 days)`);
  console.log('\nFOR LOCAL/DEV USE ONLY — never run this against a database with real users.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
