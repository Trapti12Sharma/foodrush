const Review = require('../models/Review');
const ReviewReport = require('../models/ReviewReport');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { escapeRegex } = require('../utils/regex');
const { ORDER_STATUS, REVIEW_MODERATION_STATUS, NOTIFICATION_TYPE } = require('../utils/constants');
const { PERMISSIONS, hasPermission } = require('../utils/permissions');
const notificationService = require('./notification.service');

// Only APPROVED reviews are public trust signals (Phase 5) — a review sitting in
// PENDING, or one that was REJECTED/HIDDEN, must never move a restaurant's
// rating. A plain find() (rather than an aggregation $match) lets Mongoose cast
// restaurantId against the schema's ObjectId field automatically, exactly as
// before M15 — an aggregate here would silently match zero documents whenever
// restaurantId arrives as a string.
async function recalculateRestaurantRating(restaurantId) {
  const reviews = await Review.find({ restaurant: restaurantId, moderationStatus: REVIEW_MODERATION_STATUS.APPROVED }).select('rating');
  const count = reviews.length;
  const avgRating = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;

  await Restaurant.findByIdAndUpdate(restaurantId, {
    rating: Math.round(avgRating * 10) / 10,
    totalReviews: count,
  });
}

// Only a customer whose OWN order from this restaurant has reached "delivered"
// may review it — proves they actually ordered, and the unique index on
// Review.order (Phase 2) blocks a second review for that same order. Every new
// review starts PENDING (the schema default) — nothing here ever sets
// moderationStatus from the request body, so a client can't self-approve.
async function createReview(user, { restaurant, order, rating, comment, images }) {
  const orderDoc = await Order.findById(order);
  if (!orderDoc || orderDoc.user.toString() !== user._id.toString()) {
    throw ApiError.forbidden('You can only review your own orders');
  }
  if (orderDoc.restaurant.toString() !== restaurant) {
    throw ApiError.badRequest('This order does not belong to the specified restaurant');
  }
  if (orderDoc.orderStatus !== ORDER_STATUS.DELIVERED) {
    throw ApiError.badRequest('You can only review an order after it has been delivered');
  }

  const existing = await Review.findOne({ order });
  if (existing) throw ApiError.conflict('You have already reviewed this order');

  // A brand-new review is always PENDING and can never yet be part of the
  // APPROVED average, so there is nothing to recalculate here (unlike every
  // moderation action below, which always can change the count).
  return Review.create({ user: user._id, restaurant, order, rating, comment, images });
}

// Strips fields a viewer should never see on someone ELSE's review — internal
// moderation bookkeeping (moderatedBy, reportCount, reportedAt) is never public,
// and moderationReason is only meaningful (and only shown) to the review's own
// author, who needs it to understand a rejection (Phase 11). moderationStatus
// itself is safe to keep for every row returned here: everyone else's is always
// APPROVED (the query already filters that), and the viewer's own real status is
// exactly the "is my review pending/rejected" signal Phase 11 asks for.
function toPublicView(review, viewerId) {
  const plain = typeof review.toObject === 'function' ? review.toObject() : review;
  const isOwner = viewerId && plain.user && (plain.user._id ? plain.user._id.toString() : plain.user.toString()) === viewerId.toString();
  delete plain.moderatedBy;
  delete plain.reportCount;
  delete plain.reportedAt;
  if (!isOwner) delete plain.moderationReason;
  return plain;
}

// Public listing (GET /restaurants/:id/reviews, no auth required): everyone
// sees APPROVED reviews; a signed-in caller additionally sees their OWN review
// regardless of its status, inline with everyone else's, so they can tell it
// was submitted/see why it was rejected (Phase 11) without a second endpoint.
async function listForRestaurant(restaurantId, query, viewer) {
  const { page, limit, skip } = parsePagination(query);
  const filter = viewer
    ? { restaurant: restaurantId, $or: [{ moderationStatus: REVIEW_MODERATION_STATUS.APPROVED }, { user: viewer._id }] }
    : { restaurant: restaurantId, moderationStatus: REVIEW_MODERATION_STATUS.APPROVED };

  const [items, total] = await Promise.all([
    Review.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('user', 'name avatar').lean(),
    Review.countDocuments(filter),
  ]);
  return { items: items.map((r) => toPublicView(r, viewer?._id)), pagination: buildPaginationMeta(total, page, limit) };
}

async function updateReview(user, reviewId, payload) {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');
  if (review.user.toString() !== user._id.toString() && !hasPermission(user, PERMISSIONS.REVIEWS_MODERATE)) {
    throw ApiError.forbidden('You can only edit your own review');
  }

  let contentChanged = false;
  ['rating', 'comment', 'images'].forEach((field) => {
    if (payload[field] !== undefined) {
      review[field] = payload[field];
      contentChanged = true;
    }
  });

  // Editing the review's actual content invalidates whatever moderation
  // decision was already made — it goes back into the PENDING queue for a
  // fresh look, exactly like a KYC resubmission (RESTAURANT_KYC_STATUS.VERIFIED
  // -> SUBMITTED). This is also what makes the rating aggregation correct: an
  // approved review edited to something new immediately stops counting until
  // it is re-approved (see recalculateRestaurantRating below).
  if (contentChanged) {
    review.moderationStatus = REVIEW_MODERATION_STATUS.PENDING;
    review.moderationReason = null;
    review.moderatedAt = null;
    review.moderatedBy = null;
  }

  await review.save();
  await recalculateRestaurantRating(review.restaurant);
  return review;
}

async function deleteReview(user, reviewId) {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');
  if (review.user.toString() !== user._id.toString() && !hasPermission(user, PERMISSIONS.REVIEWS_MODERATE)) {
    throw ApiError.forbidden('You can only delete your own review');
  }

  const { restaurant } = review;
  await review.deleteOne();
  await ReviewReport.deleteMany({ review: reviewId });
  await recalculateRestaurantRating(restaurant);
}

// Shared by every moderation action below: an ATOMIC conditional update —
// `findOneAndUpdate` with the required source status as part of the filter —
// rather than the usual load-then-save. Two genuinely concurrent requests to
// moderate the very same review (e.g. two admins double-clicking "approve" at
// once) can then only ever have one winner: the loser's filter no longer
// matches (the first request already changed moderationStatus), so it gets
// `null` back and a clean 400, never a lost update or a corrupted rating
// (Phase 17). Recalculating the rating afterward and notifying the author are
// both best-effort follow-ups, never part of the atomic step itself; notify()
// never throws (see notification.service.js), so a failure there can never
// roll back — or even affect — the moderation decision itself.
async function applyModeration(reviewId, fromStatus, toStatus, admin, reason, notificationType) {
  const review = await Review.findOneAndUpdate(
    { _id: reviewId, moderationStatus: fromStatus },
    {
      $set: {
        moderationStatus: toStatus,
        moderationReason: reason || null,
        moderatedAt: new Date(),
        moderatedBy: admin._id,
      },
    },
    { new: true }
  );

  if (!review) {
    // Distinguishes "doesn't exist at all" from "exists, but not in the
    // required source status anymore" — the latter is the actual race/
    // stale-UI case and deserves a precise message, not a bare 404.
    const current = await Review.findById(reviewId).select('moderationStatus');
    if (!current) throw ApiError.notFound('Review not found');
    throw ApiError.badRequest(`Cannot move this review from "${current.moderationStatus}" to "${toStatus}" — it must be "${fromStatus}" first`);
  }

  await recalculateRestaurantRating(review.restaurant);

  await notificationService.notify({
    recipient: review.user,
    type: notificationType,
    data: { reviewId: review._id, restaurantId: review.restaurant, reason: reason || undefined },
    eventKey: `REVIEW:${review._id}:${notificationType}:${review.moderatedAt.getTime()}`,
  });

  return review;
}

async function approveReview(reviewId, admin) {
  return applyModeration(reviewId, REVIEW_MODERATION_STATUS.PENDING, REVIEW_MODERATION_STATUS.APPROVED, admin, null, NOTIFICATION_TYPE.REVIEW_APPROVED);
}

async function rejectReview(reviewId, admin, reason) {
  if (!reason || !reason.trim()) throw ApiError.badRequest('A reason is required to reject a review');
  return applyModeration(reviewId, REVIEW_MODERATION_STATUS.PENDING, REVIEW_MODERATION_STATUS.REJECTED, admin, reason.trim(), NOTIFICATION_TYPE.REVIEW_REJECTED);
}

async function hideReview(reviewId, admin, reason) {
  return applyModeration(reviewId, REVIEW_MODERATION_STATUS.APPROVED, REVIEW_MODERATION_STATUS.HIDDEN, admin, reason ? reason.trim() : null, NOTIFICATION_TYPE.REVIEW_HIDDEN);
}

async function restoreReview(reviewId, admin) {
  return applyModeration(reviewId, REVIEW_MODERATION_STATUS.HIDDEN, REVIEW_MODERATION_STATUS.APPROVED, admin, null, NOTIFICATION_TYPE.REVIEW_RESTORED);
}

// A customer flags a review as inappropriate. Self-reporting and duplicate
// reports are both rejected before ever touching Review.reportCount, and the
// count itself is an atomic $inc (never read-modify-write) so two genuinely
// concurrent reports can't lose an increment (Phase 17).
async function createReport(user, reviewId, reason) {
  const review = await Review.findById(reviewId).select('user');
  if (!review) throw ApiError.notFound('Review not found');
  if (review.user.toString() === user._id.toString()) {
    throw ApiError.badRequest('You cannot report your own review');
  }

  try {
    await ReviewReport.create({ review: reviewId, reporter: user._id, reason });
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('You have already reported this review');
    throw err;
  }

  return Review.findByIdAndUpdate(reviewId, { $inc: { reportCount: 1 }, $set: { reportedAt: new Date() } }, { new: true });
}

// Admin moderation queue — every status, every restaurant, unlike the public
// listing above. `search` matches the review text itself or the reviewing
// customer's name/email (resolved to a set of ids first, mirroring
// supportTicket.service.js#listForAdmin's orderNumber -> order._id pattern);
// matching by restaurant/order NAME is left to the admin's existing
// restaurant/order lookups elsewhere rather than reinvented here.
async function listForAdmin(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.moderationStatus) filter.moderationStatus = query.moderationStatus;
  if (query.restaurant) filter.restaurant = query.restaurant;
  if (query.reported === 'true') filter.reportCount = { $gt: 0 };

  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    const matchingUsers = await User.find({ $or: [{ name: re }, { email: re }] }).select('_id').limit(200);
    filter.$or = [{ comment: re }, { user: { $in: matchingUsers.map((u) => u._id) } }];
  }

  const [items, total] = await Promise.all([
    Review.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('user', 'name email')
      .populate('restaurant', 'name')
      .populate('moderatedBy', 'name email')
      .lean(),
    Review.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

// Report reasons/counts/timing only — reporter identity is never returned by
// any API response, admin included (Phase 6/17: "do not expose reporter
// identity"). An admin who needs to investigate a reporting pattern does so
// through the database directly, not through this product surface.
async function getForAdmin(reviewId) {
  const review = await Review.findById(reviewId)
    .populate('user', 'name email')
    .populate('restaurant', 'name')
    .populate('order', 'orderNumber')
    .populate('moderatedBy', 'name email');
  if (!review) throw ApiError.notFound('Review not found');

  const reports = await ReviewReport.find({ review: reviewId }).select('reason createdAt').sort('-createdAt');
  return { review, reports };
}

module.exports = {
  createReview,
  listForRestaurant,
  updateReview,
  deleteReview,
  createReport,
  approveReview,
  rejectReview,
  hideReview,
  restoreReview,
  listForAdmin,
  getForAdmin,
  recalculateRestaurantRating,
};
