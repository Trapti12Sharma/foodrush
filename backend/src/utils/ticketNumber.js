const Counter = require('../models/Counter');

// A short, human-readable, sequential support-ticket id (FR-TKT-000001, ...) —
// exactly the same atomic-counter pattern as utils/orderNumber.js, under its own
// counter name so the two sequences never collide or interfere with each other.
// findOneAndUpdate with $inc and upsert is a single database operation, so two
// tickets created at the same instant can never be handed the same number.
async function nextTicketNumber() {
  const counter = await Counter.findOneAndUpdate({ _id: 'ticketNumber' }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `FR-TKT-${String(counter.seq).padStart(6, '0')}`;
}

module.exports = { nextTicketNumber };
