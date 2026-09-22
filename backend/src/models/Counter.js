const mongoose = require('mongoose');

// Backs atomic sequence generation (see utils/orderNumber.js) — a single document per
// named sequence, incremented with $inc so two simultaneous requests can never receive
// the same number (a race that a "count existing rows + 1" approach would not prevent).
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // sequence name, e.g. "orderNumber"
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model('Counter', counterSchema);
