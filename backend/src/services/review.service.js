const Review = require('../models/Review');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const ApiError = require('../utils/ApiError');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { ORDER_STATUS, ROLES } = require('../utils/constants');

async function recalculateRestaurantRating(restaurantId) {
  // A plain find() lets Mongoose cast the restaurantId string against the
  // schema's ObjectId field automatically; $match in an aggregation pipeline
  // does not do this casting, so an aggregate here would silently match zero
  // documents whenever restaurantId arrives as a string (e.g. from req.body).
  const reviews = await Review.find({ restaurant: restaurantId }).select('rating');
  const count = reviews.length;
  const avgRating = count ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;

  await Restaurant.findByIdAndUpdate(restaurantId, {
    rating: Math.round(avgRating * 10) / 10,
    totalReviews: count,
  });
}

// Only a customer whose OWN order from this restaurant has reached "delivered"
// may review it — proves they actually ordered, and the unique index on
// Review.order (Phase 2) blocks a second review for that same order.
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

  const review = await Review.create({ user: user._id, restaurant, order, rating, comment, images });
  await recalculateRestaurantRating(restaurant);
  return review;
}

async function listForRestaurant(restaurantId, query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { restaurant: restaurantId };

  const [items, total] = await Promise.all([
    Review.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('user', 'name avatar'),
    Review.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function updateReview(user, reviewId, payload) {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');
  if (review.user.toString() !== user._id.toString() && user.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('You can only edit your own review');
  }

  ['rating', 'comment', 'images'].forEach((field) => {
    if (payload[field] !== undefined) review[field] = payload[field];
  });
  await review.save();
  await recalculateRestaurantRating(review.restaurant);
  return review;
}

async function deleteReview(user, reviewId) {
  const review = await Review.findById(reviewId);
  if (!review) throw ApiError.notFound('Review not found');
  if (review.user.toString() !== user._id.toString() && user.role !== ROLES.ADMIN) {
    throw ApiError.forbidden('You can only delete your own review');
  }

  const { restaurant } = review;
  await review.deleteOne();
  await recalculateRestaurantRating(restaurant);
}

module.exports = { createReview, listForRestaurant, updateReview, deleteReview };
