// Gives every demo restaurant its OWN login, instead of the single
// restaurant@example.com account owning all of them.
//
// WHY THIS IS A SCRIPT AND NOT AN API CALL: `owner` is deliberately excluded
// from the restaurant update endpoint's allow-list (see UPDATE_FIELDS in
// services/restaurant.service.js). If it were settable, any owner could hand
// themselves someone else's restaurant. Re-homing existing demo data is
// therefore an operator action, not something the app exposes.
//
// The application itself is already multi-tenant: listMyRestaurants filters by
// { owner }, and every write path runs through assertOwnerOrAdmin. The reason
// one login currently sees all 13 restaurants is purely that seed.js created
// them all under one user — a fixture choice, not a permissions hole.
//
// Safe to re-run: users are looked up before being created, and a restaurant
// that already has its own dedicated owner is left alone.
//
// FOR LOCAL / DEMO DATA ONLY. Never point this at a database with real accounts:
// it creates logins with a known password.
require('dotenv').config();
const mongoose = require('mongoose');

const { User, Restaurant } = require('../src/models');
const { ROLES } = require('../src/utils/constants');

const DEMO_PASSWORD = 'password123';
const EMAIL_DOMAIN = 'foodrush.test';

// "Napoli Wood Fire Pizza" -> "napoli-wood-fire-pizza"
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to ${mongoose.connection.name}\n`);

  const restaurants = await Restaurant.find({}).sort('name');
  if (restaurants.length === 0) {
    console.log('No restaurants found — run seeds/seed.js first.');
    await mongoose.disconnect();
    return;
  }

  const credentials = [];

  for (const restaurant of restaurants) {
    const email = `${slugify(restaurant.name)}@${EMAIL_DOMAIN}`;

    let owner = await User.findOne({ email });
    if (!owner) {
      owner = await User.create({
        name: `${restaurant.name} Owner`,
        email,
        password: DEMO_PASSWORD,
        role: ROLES.RESTAURANT_OWNER,
      });
    }

    const alreadyMine = restaurant.owner && restaurant.owner.toString() === owner._id.toString();
    if (!alreadyMine) {
      restaurant.owner = owner._id;
      await restaurant.save();
    }

    credentials.push({ restaurant: restaurant.name, email, moved: !alreadyMine });
  }

  console.log('Per-restaurant logins (all share the same demo password):\n');
  for (const row of credentials) {
    console.log(`  ${row.restaurant.padEnd(28)} ${row.email.padEnd(40)} ${row.moved ? '(reassigned)' : '(already owned)'}`);
  }
  console.log(`\n  Password for all of the above: ${DEMO_PASSWORD}`);
  console.log('\nThe original restaurant@example.com account now owns nothing, so it will');
  console.log('see the "create your first restaurant" onboarding screen. Admins still see');
  console.log('every restaurant via the admin console.');

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('SPLIT OWNERS FAILED:', err);
  process.exit(1);
});
