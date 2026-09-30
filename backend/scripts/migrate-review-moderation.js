// One-time backfill: M15 added Review.moderationStatus, defaulting every NEW
// review to PENDING (never auto-approved) — but a review written before M15
// existed was already fully public and already counted toward its
// restaurant's rating under the old code, with no moderation step at all.
// Leaving it at the schema default would retroactively de-list it (public
// listing/rating aggregation are both moderationStatus === APPROVED-gated
// now) and would misrepresent something that was already trusted and live as
// newly "awaiting review". This backfill sets moderationStatus to APPROVED
// for every review that predates this field.
//
// Nothing else is touched: no document is deleted, review content
// (rating/comment/images) is never changed, and a review that already has an
// explicit moderationStatus (i.e. it was created by the real M15 flow, or
// this script already ran for it) is left alone — safe to run more than once.
//
// No rating recalculation step is needed afterward: every review this script
// touches was ALREADY counted in its restaurant's rating/totalReviews before
// M15 (there was no gate), and mapping it to APPROVED is exactly the set
// recalculateRestaurantRating now uses — the counted set does not change, only
// the explicit status field catches up to what was already true.
//
//   node scripts/migrate-review-moderation.js            # dry run: reports what would change
//   node scripts/migrate-review-moderation.js --apply    # applies it
//
// DRY RUN BY DEFAULT.
require('dotenv').config();
const mongoose = require('mongoose');
const Review = require('../src/models/Review');
const { REVIEW_MODERATION_STATUS } = require('../src/utils/constants');

async function migrateReviewModeration({ apply = false, log = () => {} } = {}) {
  const summary = { toUpdate: 0, updated: 0, failed: [] };
  // Counted up front — before the loop below writes anything — so this reflects
  // how many reviews already had a moderationStatus going INTO this run.
  summary.alreadyMigrated = await Review.countDocuments({ moderationStatus: { $exists: true } });

  // Only documents written before this field existed at all — a review already
  // through the real M15 flow (or a previous run of this script) has an
  // explicit moderationStatus and must never be overwritten here.
  const cursor = Review.find({ moderationStatus: { $exists: false } }).cursor();
  for await (const review of cursor) {
    summary.toUpdate += 1;
    log(`  review ${review._id} (restaurant ${review.restaurant}): moderationStatus -> "${REVIEW_MODERATION_STATUS.APPROVED}" (pre-M15, already public)`);

    if (!apply) continue;

    review.moderationStatus = REVIEW_MODERATION_STATUS.APPROVED;
    // A reasonable, honest placeholder — we don't know who "moderated" a
    // pre-M15 review (nothing did), so moderatedBy stays null rather than
    // falsely attributing it to anyone; moderatedAt uses the review's own
    // creation time, which is more useful than leaving it blank.
    review.moderatedAt = review.createdAt;

    try {
      await review.save();
      summary.updated += 1;
    } catch (err) {
      summary.failed.push({ reviewId: review._id.toString(), error: err.message });
    }
  }

  return summary;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}". Mode: ${apply ? 'APPLY' : 'DRY RUN (no changes)'}`);

  const summary = await migrateReviewModeration({ apply, log: (line) => console.log(line) });

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${apply ? summary.updated : summary.toUpdate} review(s).`);
  console.log(`Already had a moderationStatus (untouched): ${summary.alreadyMigrated}.`);
  if (summary.failed.length) {
    console.log(`\n${summary.failed.length} review(s) failed to save (needs manual review):`);
    summary.failed.forEach((f) => console.log(`  ${f.reviewId}: ${f.error}`));
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

module.exports = { migrateReviewModeration };
