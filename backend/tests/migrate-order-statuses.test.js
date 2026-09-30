require('./setup');
const mongoose = require('mongoose');
const Order = require('../src/models/Order');
const { migrateOrderStatuses, STATUS_MAP } = require('../scripts/migrate-order-statuses');

// Bypasses Mongoose's own validation/casting so a genuinely OLD-shaped document
// (lowercase statuses, no orderNumber) can exist in the test database, exactly as
// a real pre-migration production document would — Order.create() would refuse
// these values outright under the CURRENT schema.
async function insertLegacyOrder(overrides = {}) {
  const doc = {
    user: new mongoose.Types.ObjectId(),
    restaurant: new mongoose.Types.ObjectId(),
    items: [{ food: new mongoose.Types.ObjectId(), name: 'Legacy Item', price: 100, quantity: 1, addons: [] }],
    deliveryAddress: { addressLine: '1 Old Rd', city: 'Pune', pincode: '411001' },
    subtotal: 100, deliveryFee: 10, tax: 5, discount: 0, totalAmount: 115,
    paymentMethod: 'COD', paymentStatus: 'pending',
    orderStatus: 'pending',
    statusHistory: [{ status: 'pending', changedAt: new Date(), changedBy: new mongoose.Types.ObjectId() }],
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
  const { insertedId } = await Order.collection.insertOne(doc);
  return insertedId;
}

describe('migrateOrderStatuses', () => {
  it('maps every old status to its new uppercase value', () => {
    expect(STATUS_MAP).toEqual({
      pending: 'PLACED', confirmed: 'CONFIRMED', preparing: 'PREPARING', ready_for_pickup: 'READY_FOR_PICKUP',
      out_for_delivery: 'OUT_FOR_DELIVERY', delivered: 'DELIVERED', cancelled: 'CANCELLED', rejected: 'REJECTED',
    });
  });

  it('dry run reports what would change without writing anything', async () => {
    const id = await insertLegacyOrder();
    const summary = await migrateOrderStatuses({ apply: false });
    expect(summary.ordersToUpdate).toBe(1);
    expect(summary.ordersUpdated).toBe(0);

    const raw = await Order.collection.findOne({ _id: id });
    expect(raw.orderStatus).toBe('pending'); // untouched
    expect(raw.orderNumber).toBeUndefined();
  });

  it('applies the status rename and backfills an orderNumber, leaving every other field untouched', async () => {
    const id = await insertLegacyOrder({
      orderStatus: 'delivered',
      statusHistory: [
        { status: 'pending', changedAt: new Date(), changedBy: null },
        { status: 'confirmed', changedAt: new Date(), changedBy: null },
        { status: 'delivered', changedAt: new Date(), changedBy: null },
      ],
    });

    const summary = await migrateOrderStatuses({ apply: true });
    expect(summary.ordersUpdated).toBe(1);
    expect(summary.orderNumbersAssigned).toBe(1);

    const migrated = await Order.findById(id);
    expect(migrated.orderStatus).toBe('DELIVERED');
    expect(migrated.statusHistory.map((h) => h.status)).toEqual(['PLACED', 'CONFIRMED', 'DELIVERED']);
    expect(migrated.orderNumber).toMatch(/^FR\d{8}$/);
    // Nothing else moved.
    expect(migrated.totalAmount).toBe(115);
    expect(migrated.deliveryAddress.addressLine).toBe('1 Old Rd');
    expect(migrated.paymentMethod).toBe('COD');
  });

  it('is idempotent — a second run changes nothing further', async () => {
    await insertLegacyOrder();
    await migrateOrderStatuses({ apply: true });
    const again = await migrateOrderStatuses({ apply: true });
    expect(again.ordersUpdated).toBe(0);
    expect(again.alreadyMigrated).toBe(1);
  });

  it('never touches an order that is already fully on the new format', async () => {
    const modernOrder = await Order.create({
      orderNumber: 'FR00000099', user: new mongoose.Types.ObjectId(), restaurant: new mongoose.Types.ObjectId(),
      items: [{ food: new mongoose.Types.ObjectId(), name: 'Modern Item', price: 50, quantity: 1, addons: [] }],
      deliveryAddress: { addressLine: '1 New Rd', city: 'Pune', pincode: '411001' },
      subtotal: 50, deliveryFee: 10, tax: 2.5, discount: 0, totalAmount: 62.5,
      paymentMethod: 'COD', orderStatus: 'PLACED', statusHistory: [{ status: 'PLACED' }],
    });
    const summary = await migrateOrderStatuses({ apply: true });
    expect(summary.ordersUpdated).toBe(0);
    expect(summary.alreadyMigrated).toBe(1);
    expect((await Order.findById(modernOrder._id)).orderNumber).toBe('FR00000099'); // unchanged
  });

  it('skips (and reports) an order with a genuinely unrecognised orderStatus, rather than guessing', async () => {
    const id = await insertLegacyOrder({ orderStatus: 'some_future_status_v9' });
    const summary = await migrateOrderStatuses({ apply: true });
    expect(summary.ordersUpdated).toBe(0);
    expect(summary.unknownStatuses).toEqual([{ orderId: id.toString(), status: 'some_future_status_v9' }]);
    expect((await Order.collection.findOne({ _id: id })).orderStatus).toBe('some_future_status_v9'); // left alone
  });

  it('skips (and reports) an order with an unrecognised value inside statusHistory', async () => {
    const id = await insertLegacyOrder({
      orderStatus: 'pending',
      statusHistory: [{ status: 'some_weird_legacy_value', changedAt: new Date(), changedBy: null }],
    });
    const summary = await migrateOrderStatuses({ apply: true });
    expect(summary.ordersUpdated).toBe(0);
    expect(summary.unknownStatuses).toEqual([{ orderId: id.toString(), status: 'some_weird_legacy_value', field: 'statusHistory' }]);
    expect((await Order.collection.findOne({ _id: id })).orderStatus).toBe('pending'); // left fully alone
  });

  it('an unrelated bad order does not stop the rest of the batch from migrating', async () => {
    const goodId = await insertLegacyOrder();
    const badId = await insertLegacyOrder({ orderStatus: 'not_a_real_status' });
    const summary = await migrateOrderStatuses({ apply: true });
    expect(summary.ordersUpdated).toBe(1);
    expect(summary.unknownStatuses).toHaveLength(1);
    expect((await Order.findById(goodId)).orderStatus).toBe('PLACED');
    expect((await Order.collection.findOne({ _id: badId })).orderStatus).toBe('not_a_real_status');
  });

  it('assigns sequential, unique order numbers across a batch', async () => {
    const ids = await Promise.all([insertLegacyOrder(), insertLegacyOrder(), insertLegacyOrder()]);
    await migrateOrderStatuses({ apply: true });
    const numbers = await Promise.all(ids.map(async (id) => (await Order.findById(id)).orderNumber));
    expect(new Set(numbers).size).toBe(3);
    numbers.forEach((n) => expect(n).toMatch(/^FR\d{8}$/));
  });
});
