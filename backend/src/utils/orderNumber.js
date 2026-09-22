const Counter = require('../models/Counter');

// A short, human-readable, sequential order id (FR00000001, FR00000002, ...) —
// something a customer can read over the phone to support, unlike a Mongo ObjectId.
// Atomic: findOneAndUpdate with $inc and upsert is a single database operation, so
// two orders created at the same instant can never be handed the same number.
async function nextOrderNumber() {
  const counter = await Counter.findOneAndUpdate({ _id: 'orderNumber' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `FR${String(counter.seq).padStart(8, '0')}`;
}

module.exports = { nextOrderNumber };
