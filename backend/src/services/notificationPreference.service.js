const NotificationPreference = require('../models/NotificationPreference');

// Explicit whitelist — never persist an arbitrary client-supplied key. Matches
// the schema's own fields exactly; a request body with an unknown key simply has
// that key ignored, never stored.
const EDITABLE_FIELDS = ['orderUpdates', 'paymentUpdates', 'deliveryUpdates', 'supportUpdates', 'marketing'];

function pickBooleans(source, fields) {
  const result = {};
  fields.forEach((field) => {
    if (source[field] !== undefined) result[field] = Boolean(source[field]);
  });
  return result;
}

// Lazily created on first read/write with the schema's own defaults — every
// existing user account already behaves as if this exists (see the model's own
// comment), so there is no migration/backfill needed for accounts that predate M12.
async function getForUser(user) {
  const existing = await NotificationPreference.findOne({ user: user._id });
  if (existing) return existing;
  return NotificationPreference.create({ user: user._id });
}

async function updateForUser(user, payload) {
  const data = pickBooleans(payload, EDITABLE_FIELDS);
  // The `user` filter field is included in the new document automatically on
  // upsert (standard MongoDB behavior for an equality filter field not
  // otherwise touched by the update) — no separate $setOnInsert needed.
  return NotificationPreference.findOneAndUpdate({ user: user._id }, { $set: data }, { new: true, upsert: true });
}

module.exports = { getForUser, updateForUser, EDITABLE_FIELDS };
