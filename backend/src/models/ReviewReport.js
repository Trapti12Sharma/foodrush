const mongoose = require('mongoose');
const { REVIEW_REPORT_REASON } = require('../utils/constants');

// M15 — one row per (review, reporter) pair. Deliberately minimal (see
// review.service.js#createReport): no free-text detail field, no status of its
// own — a report is just a signal that feeds Review.reportCount/reportedAt, and
// the review's own moderationStatus is what actually gates visibility. Reporter
// identity is intentionally never surfaced by any API response (not even to
// admins) — see review.service.js#getForAdmin.
const reviewReportSchema = new mongoose.Schema(
  {
    review: { type: mongoose.Schema.Types.ObjectId, ref: 'Review', required: true, index: true },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: Object.values(REVIEW_REPORT_REASON), required: true },
  },
  { timestamps: true }
);

// One report per customer per review — a second attempt hits this and is
// turned into a 409 (see review.service.js#createReport), never a duplicate row.
reviewReportSchema.index({ review: 1, reporter: 1 }, { unique: true });

module.exports = mongoose.model('ReviewReport', reviewReportSchema);
