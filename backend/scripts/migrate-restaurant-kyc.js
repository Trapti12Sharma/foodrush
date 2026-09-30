// One-time backfill: M14 added Restaurant.kycStatus, defaulting every NEW
// restaurant to NOT_SUBMITTED — but a restaurant that predates M14 and is
// already `isApproved: true` was approved under the old boolean-only system and
// never actually went through this new document-submission flow. Leaving its
// kycStatus at the schema default would misrepresent it as "never submitted"
// even though it is live and has been operating. This backfill sets kycStatus
// to VERIFIED for any already-approved restaurant, and leaves an unapproved one
// at NOT_SUBMITTED (accurate either way — it genuinely hasn't been through KYC).
//
// Nothing else is touched: no document is deleted, isApproved/isActive are never
// changed, and a restaurant that already has an explicit kycStatus (i.e. this
// script, or the real submit/approve/reject flow, already ran for it) is left
// alone — safe to run more than once.
//
//   node scripts/migrate-restaurant-kyc.js            # dry run: reports what would change
//   node scripts/migrate-restaurant-kyc.js --apply    # applies it
//
// DRY RUN BY DEFAULT.
require('dotenv').config();
const mongoose = require('mongoose');
const Restaurant = require('../src/models/Restaurant');
const { RESTAURANT_KYC_STATUS } = require('../src/utils/constants');

async function migrateRestaurantKyc({ apply = false, log = () => {} } = {}) {
  const summary = { toUpdate: 0, updated: 0, failed: [] };
  // Counted up front — before the loop below writes anything — so this reflects
  // how many restaurants already had a kycStatus going INTO this run.
  summary.alreadyMigrated = await Restaurant.countDocuments({ kycStatus: { $exists: true } });

  // Only documents that were written before this field existed at all — a
  // restaurant that has already been through (or explicitly started) the real
  // KYC flow has a kycStatus set by that flow and must never be overwritten here.
  const cursor = Restaurant.find({ kycStatus: { $exists: false } }).cursor();
  for await (const restaurant of cursor) {
    const nextStatus = restaurant.isApproved ? RESTAURANT_KYC_STATUS.VERIFIED : RESTAURANT_KYC_STATUS.NOT_SUBMITTED;
    summary.toUpdate += 1;
    log(`  restaurant ${restaurant._id} ("${restaurant.name}"): kycStatus -> "${nextStatus}"${restaurant.isApproved ? ' (already approved)' : ''}`);

    if (!apply) continue;

    restaurant.kycStatus = nextStatus;
    if (nextStatus === RESTAURANT_KYC_STATUS.VERIFIED) {
      // A reasonable, honest placeholder — we don't know who reviewed a
      // pre-M14 approval or exactly when its documents (if any, informally,
      // outside this system) were checked; recording the restaurant's own
      // createdAt is more useful than leaving these blank, and reviewedBy
      // stays null rather than falsely attributing it to anyone.
      restaurant.kycReviewedAt = restaurant.createdAt;
    }

    try {
      await restaurant.save();
      summary.updated += 1;
    } catch (err) {
      summary.failed.push({ restaurantId: restaurant._id.toString(), error: err.message });
    }
  }

  return summary;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}". Mode: ${apply ? 'APPLY' : 'DRY RUN (no changes)'}`);

  const summary = await migrateRestaurantKyc({ apply, log: (line) => console.log(line) });

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${apply ? summary.updated : summary.toUpdate} restaurant(s).`);
  console.log(`Already had a kycStatus (untouched): ${summary.alreadyMigrated}.`);
  if (summary.failed.length) {
    console.log(`\n${summary.failed.length} restaurant(s) failed to save (needs manual review):`);
    summary.failed.forEach((f) => console.log(`  ${f.restaurantId}: ${f.error}`));
  }
  if (!apply) console.log('\nNothing was changed. Re-run with --apply to make the change.');

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(`Migration failed: ${err.message}`);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { migrateRestaurantKyc };
