const mongoose = require('mongoose');
const { NOTIFICATION_TYPE, NOTIFICATION_EMAIL_STATUS } = require('../utils/constants');

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recipientRole: { type: String, required: true },
    type: { type: String, enum: Object.values(NOTIFICATION_TYPE), required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 150 },
    message: { type: String, required: true, trim: true, maxlength: 500 },
    // Minimal, structured navigation context for the frontend (e.g. {orderId,
    // orderNumber}) — never a raw Mongoose document, and never anything
    // credential/OTP-shaped (see notification.service.js's buildContent, the
    // single place every notification's data is assembled).
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    // In-app is effectively always true in this milestone (there is no UI to turn
    // it off — see notification.service.js's design note); email reflects whether
    // that channel was actually REQUESTED for this event, before any provider/
    // preference gating is applied (see emailStatus for the actual outcome).
    channels: {
      inApp: { type: Boolean, default: true },
      email: { type: Boolean, default: false },
    },
    // Idempotency key for "this exact business event, for this exact recipient" —
    // e.g. "ORDER:<orderId>:PLACED:<recipientId>". Unique + sparse: a naturally
    // repeatable event (a second, distinct support-ticket reply) simply omits it
    // rather than being forced into an artificial uniqueness constraint.
    eventKey: { type: String, default: null },
    readAt: { type: Date, default: null },

    // Best-effort email delivery bookkeeping (Part 14) — deliberately no queue/
    // worker: emailStatus starts PENDING only when a send is actually attempted
    // inline, and becomes SENT/FAILED synchronously from that same attempt. See
    // notification.service.js#attemptEmail.
    emailStatus: { type: String, enum: Object.values(NOTIFICATION_EMAIL_STATUS), default: NOTIFICATION_EMAIL_STATUS.SKIPPED },
    emailAttempts: { type: Number, default: 0 },
    lastEmailAttemptAt: { type: Date, default: null },
    emailSentAt: { type: Date, default: null },
    emailError: { type: String, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, readAt: 1 });
notificationSchema.index({ recipient: 1, type: 1, createdAt: -1 });
notificationSchema.index({ eventKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Notification', notificationSchema);
