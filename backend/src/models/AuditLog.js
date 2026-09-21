const mongoose = require('mongoose');

// Append-only record of security- and money-relevant actions taken by staff and
// owners (approvals, account changes, coupon edits, order overrides...). Written
// through audit.service.js, which redacts secrets before anything is stored.
// The immutability hooks below block edits/deletes made through Mongoose; direct
// database access is, by nature, outside what application code can prevent.
const auditLogSchema = new mongoose.Schema(
  {
    // null for actions with no logged-in user (e.g. the super-admin bootstrap script).
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorRole: { type: String, default: null },
    // Dotted verb, e.g. "restaurant.approve", "user.set_active", "coupon.create".
    action: { type: String, required: true, trim: true },
    entityType: { type: String, default: null },
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

function immutable() {
  throw new Error('Audit log entries are append-only');
}

auditLogSchema.pre('save', function blockUpdates(next) {
  if (!this.isNew) return next(new Error('Audit log entries are append-only'));
  next();
});
['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'].forEach(
  (op) => auditLogSchema.pre(op, immutable)
);

module.exports = mongoose.model('AuditLog', auditLogSchema);
