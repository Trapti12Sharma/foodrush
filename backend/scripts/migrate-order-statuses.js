// One-time migration: order statuses moved from lowercase (pending, confirmed, ...)
// to uppercase (PLACED, CONFIRMED, ...) — see utils/constants.js. Converts
// Order.orderStatus and every Order.statusHistory[].status. Nothing else changes:
// no document is deleted, no other field is touched, and orders that are already
// on the new values are left alone (safe to run more than once).
//
//   node scripts/migrate-order-statuses.js            # dry run: reports what would change
//   node scripts/migrate-order-statuses.js --apply    # applies it
//
// DRY RUN BY DEFAULT. Also assigns an orderNumber (see utils/orderNumber.js) to any
// order that does not already have one — both changes are part of the same M5
// upgrade and safe to apply together.
//
// Also backfills Order.orderNumber for pre-existing orders that predate it, and
// leaves every other field untouched.
require('dotenv').config();
const mongoose = require('mongoose');
const Order = require('../src/models/Order');
const { nextOrderNumber } = require('../src/utils/orderNumber');

// Old lowercase value -> new uppercase value. PENDING became PLACED (see
// utils/constants.js for why); every other status just changed case.
const STATUS_MAP = {
  pending: 'PLACED',
  confirmed: 'CONFIRMED',
  preparing: 'PREPARING',
  ready_for_pickup: 'READY_FOR_PICKUP',
  out_for_delivery: 'OUT_FOR_DELIVERY',
  delivered: 'DELIVERED',
  cancelled: 'CANCELLED',
  rejected: 'REJECTED',
};
const NEW_VALUES = new Set(Object.values(STATUS_MAP));

async function migrateOrderStatuses({ apply = false, log = () => {} } = {}) {
  const summary = { ordersToUpdate: 0, ordersUpdated: 0, orderNumbersAssigned: 0, alreadyMigrated: 0, unknownStatuses: [], failed: [] };

  // Cursor, not .find().lean() into memory — safe for a large orders collection.
  const cursor = Order.find({}).cursor();
  for await (const order of cursor) {
    const oldStatus = order.orderStatus;
    const needsStatusMigration = !NEW_VALUES.has(oldStatus);
    const needsOrderNumber = !order.orderNumber;

    if (!needsStatusMigration && !needsOrderNumber) {
      summary.alreadyMigrated += 1;
      continue;
    }

    if (needsStatusMigration) {
      if (!STATUS_MAP[oldStatus]) {
        summary.unknownStatuses.push({ orderId: order._id.toString(), status: oldStatus });
        continue; // don't guess — leave it for manual inspection
      }
      summary.ordersToUpdate += 1;
      log(`  order ${order._id}: orderStatus "${oldStatus}" -> "${STATUS_MAP[oldStatus]}"`);
    }
    if (needsOrderNumber) log(`  order ${order._id}: assigning an orderNumber`);

    if (!apply) continue;

    // An unrecognised value inside statusHistory (as opposed to orderStatus, checked
    // above) would fail this document's schema validation on save — caught below
    // and reported rather than left half-migrated or aborting every other order.
    const unmappedHistoryEntry = order.statusHistory.find((entry) => !NEW_VALUES.has(entry.status) && !STATUS_MAP[entry.status]);
    if (unmappedHistoryEntry) {
      summary.unknownStatuses.push({ orderId: order._id.toString(), status: unmappedHistoryEntry.status, field: 'statusHistory' });
      continue;
    }

    if (needsStatusMigration) {
      order.orderStatus = STATUS_MAP[oldStatus];
      order.statusHistory.forEach((entry) => {
        if (STATUS_MAP[entry.status]) entry.status = STATUS_MAP[entry.status];
      });
    }
    if (needsOrderNumber) order.orderNumber = await nextOrderNumber();

    try {
      // validateBeforeSave stays on: this still needs to pass the model's own rules.
      await order.save();
      summary.ordersUpdated += 1;
      if (needsOrderNumber) summary.orderNumbersAssigned += 1;
    } catch (err) {
      summary.failed.push({ orderId: order._id.toString(), error: err.message });
    }
  }

  return summary;
}

async function main() {
  const apply = process.argv.includes('--apply');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is not set.');

  await mongoose.connect(process.env.MONGODB_URI);
  console.log(`Connected to database "${mongoose.connection.name}". Mode: ${apply ? 'APPLY' : 'DRY RUN (no changes)'}`);

  const summary = await migrateOrderStatuses({ apply, log: (line) => console.log(line) });

  console.log(`\n${apply ? 'Updated' : 'Would update'}: ${apply ? summary.ordersUpdated : summary.ordersToUpdate} order(s).`);
  console.log(`Order numbers assigned: ${summary.orderNumbersAssigned}. Already on the new format: ${summary.alreadyMigrated}.`);
  if (summary.unknownStatuses.length) {
    console.log(`\nSkipped ${summary.unknownStatuses.length} order(s) with an unrecognised status (needs manual review):`);
    summary.unknownStatuses.forEach((s) => console.log(`  ${s.orderId} (${s.field || 'orderStatus'}): "${s.status}"`));
  }
  if (summary.failed.length) {
    console.log(`\n${summary.failed.length} order(s) failed to save (needs manual review):`);
    summary.failed.forEach((f) => console.log(`  ${f.orderId}: ${f.error}`));
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

module.exports = { migrateOrderStatuses, STATUS_MAP };
