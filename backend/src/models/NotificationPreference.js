const mongoose = require('mongoose');

// One document per user, created lazily with these defaults the first time it's
// needed (see notificationPreference.service.js#getForUser) rather than at
// registration — every existing user account already has one implicitly, via
// the default. `marketing` defaults false per instruction ("disabled by default
// unless explicitly enabled") — M12 sends no marketing messages of any kind;
// this field only exists so a later milestone has somewhere to check.
//
// Deliberately does NOT gate ACCOUNT_SECURITY/SYSTEM notifications — those are
// mandatory and always delivered regardless of any preference here (see
// utils/constants.js NOTIFICATION_PREFERENCE_FIELD, which has no entry for them).
const notificationPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    orderUpdates: { type: Boolean, default: true },
    paymentUpdates: { type: Boolean, default: true },
    deliveryUpdates: { type: Boolean, default: true },
    supportUpdates: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('NotificationPreference', notificationPreferenceSchema);
