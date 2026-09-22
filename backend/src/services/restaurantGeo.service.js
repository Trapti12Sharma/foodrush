const Restaurant = require('../models/Restaurant');
const FoodItem = require('../models/FoodItem');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const restaurantService = require('./restaurant.service');
const {
  DEFAULT_DELIVERY_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
  MINUTES_PER_KM,
  isValidPointCoordinates,
  haversineKm,
  roundTo,
} = require('../utils/geo');
const { openNowExpression } = require('../utils/openingHours');

const DEFAULT_SEARCH_RADIUS_KM = 10;

// Sort keys are an allow-list; `_id` is a stable tie-breaker so pages never overlap.
const SORTS = {
  recommended: { rating: -1, totalReviews: -1, distanceMeters: 1, _id: 1 },
  distance: { distanceMeters: 1, _id: 1 },
  rating: { rating: -1, distanceMeters: 1, _id: 1 },
  deliveryTime: { estimatedDeliveryMinutes: 1, distanceMeters: 1, _id: 1 },
  deliveryFee: { deliveryFee: 1, distanceMeters: 1, _id: 1 },
  price: { avgPrice: 1, distanceMeters: 1, _id: 1 },
};

// Only fields safe for the public — never the owner, approval flags or internal timestamps.
const PUBLIC_FIELDS = [
  'name', 'description', 'image', 'coverImage', 'logo', 'cuisine', 'address', 'city', 'location',
  'rating', 'totalReviews', 'deliveryTime', 'deliveryFee', 'minimumOrder', 'isOpen', 'isOpenNow', 'radiusKm',
  'distanceKm', 'estimatedDeliveryMinutes', 'deliverable', 'hasOffer', 'isPureVeg', 'servesNonVeg', 'avgPrice',
];

// Restaurants around a point, nearest first by default, with real distances.
//
// $geoNear must be the first stage and does the distance work (using the 2dsphere index).
// Restaurants without coordinates are never returned — they can't be placed on the map,
// which is also why an unset location must not silently default to [0, 0].
//
// Per-restaurant menu facts (veg / non-veg / offers / typical price) come from ONE $lookup
// against the indexed foods collection, applied to the restaurants already inside the
// search radius — fine at this scale; denormalising them onto the restaurant is the next
// step if the catalog grows large.
async function findNearby(query) {
  const latitude = Number(query.lat);
  const longitude = Number(query.lng);
  const radiusKm = Math.min(Number(query.radius) || DEFAULT_SEARCH_RADIUS_KM, MAX_SEARCH_RADIUS_KM);
  const { page, limit, skip } = parsePagination(query);
  const flag = (name) => query[name] === 'true';

  const geoQuery = { isApproved: true, isActive: true };
  if (query.search) {
    const re = new RegExp(escapeRegex(query.search), 'i');
    geoQuery.$or = [{ name: re }, { cuisine: re }];
  }
  if (query.cuisine) geoQuery.cuisine = new RegExp(`^${escapeRegex(query.cuisine)}$`, 'i');
  if (query.minRating) geoQuery.rating = { $gte: Number(query.minRating) };

  // `isOpenNow` combines the manual pause flag with the weekly schedule (utils/openingHours.js)
  // and can't be expressed inside $geoNear's plain `query`, so openNow is applied as a $match
  // once it has been computed below, not folded into geoQuery like the other simple filters.
  const now = new Date();
  const afterDistance = {};
  if (query.maxDeliveryTime) afterDistance.estimatedDeliveryMinutes = { $lte: Number(query.maxDeliveryTime) };

  const afterMenu = {};
  if (flag('veg')) afterMenu.isPureVeg = true;
  if (flag('nonVeg')) afterMenu.servesNonVeg = true;
  if (flag('hasOffer')) afterMenu.hasOffer = true;
  if (query.maxPrice) afterMenu.avgPrice = { $gt: 0, $lte: Number(query.maxPrice) };

  const pipeline = [
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distanceMeters',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: geoQuery,
      },
    },
    {
      $addFields: {
        distanceKm: { $round: [{ $divide: ['$distanceMeters', 1000] }, 1] },
        radiusKm: { $ifNull: ['$deliveryRadiusKm', DEFAULT_DELIVERY_RADIUS_KM] },
        isOpenNow: openNowExpression(now),
      },
    },
    { $addFields: { deliverable: { $lte: [{ $divide: ['$distanceMeters', 1000] }, '$radiusKm'] } } },
    ...(flag('includeOutOfRange') ? [] : [{ $match: { deliverable: true } }]),
    ...(flag('openNow') ? [{ $match: { isOpenNow: true } }] : []),
    {
      $addFields: {
        estimatedDeliveryMinutes: { $round: [{ $add: ['$deliveryTime', { $multiply: ['$distanceKm', MINUTES_PER_KM] }] }, 0] },
      },
    },
    ...(Object.keys(afterDistance).length ? [{ $match: afterDistance }] : []),
    {
      $lookup: {
        from: FoodItem.collection.name,
        let: { rid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$restaurant', '$$rid'] }, isAvailable: true } },
          {
            $group: {
              _id: null,
              itemCount: { $sum: 1 },
              vegCount: { $sum: { $cond: ['$isVeg', 1, 0] } },
              offerCount: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$discountPrice', null] }, null] }, 1, 0] } },
              avgPrice: { $avg: { $ifNull: ['$discountPrice', '$price'] } },
            },
          },
        ],
        as: 'menu',
      },
    },
    { $addFields: { menu: { $ifNull: [{ $arrayElemAt: ['$menu', 0] }, { itemCount: 0, vegCount: 0, offerCount: 0, avgPrice: 0 }] } } },
    {
      $addFields: {
        hasOffer: { $gt: ['$menu.offerCount', 0] },
        isPureVeg: { $and: [{ $gt: ['$menu.itemCount', 0] }, { $eq: ['$menu.vegCount', '$menu.itemCount'] }] },
        servesNonVeg: { $gt: [{ $subtract: ['$menu.itemCount', '$menu.vegCount'] }, 0] },
        avgPrice: { $round: ['$menu.avgPrice', 0] },
      },
    },
    ...(Object.keys(afterMenu).length ? [{ $match: afterMenu }] : []),
    {
      $facet: {
        items: [
          { $sort: SORTS[query.sort] || SORTS.recommended },
          { $skip: skip },
          { $limit: limit },
          { $project: Object.fromEntries(PUBLIC_FIELDS.map((f) => [f, 1])) },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [result] = await Restaurant.aggregate(pipeline);
  const total = result.total[0]?.count || 0;

  return {
    items: result.items,
    pagination: buildPaginationMeta(total, page, limit),
    searchedFrom: { latitude, longitude, radiusKm },
  };
}

// Cities that currently have live restaurants, with the average position of their
// restaurants — a location picker that works without any Google key.
async function listCities() {
  const cities = await Restaurant.aggregate([
    { $match: { isApproved: true, isActive: true } },
    {
      $group: {
        _id: { $toLower: '$city' },
        city: { $first: '$city' },
        restaurantCount: { $sum: 1 },
        latitude: { $avg: { $arrayElemAt: ['$location.coordinates', 1] } },
        longitude: { $avg: { $arrayElemAt: ['$location.coordinates', 0] } },
      },
    },
    { $sort: { restaurantCount: -1, city: 1 } },
    { $project: { _id: 0, city: 1, restaurantCount: 1, latitude: { $round: ['$latitude', 4] }, longitude: { $round: ['$longitude', 4] } } },
  ]);
  return cities;
}

// The single rule for "does this restaurant deliver to this point". `deliverable` is null
// (unknown) when the restaurant has no coordinates — never a guess.
function evaluateDelivery(restaurant, latitude, longitude) {
  const radiusKm = restaurant.deliveryRadiusKm ?? DEFAULT_DELIVERY_RADIUS_KM;
  const coordinates = restaurant.location?.coordinates;
  if (!isValidPointCoordinates(coordinates)) return { deliverable: null, distanceKm: null, radiusKm };

  const distanceKm = roundTo(haversineKm(latitude, longitude, coordinates[1], coordinates[0]), 1);
  return { deliverable: distanceKm <= radiusKm, distanceKm, radiusKm };
}

async function checkDelivery(restaurantId, latitude, longitude, requester) {
  const restaurant = await restaurantService.getRestaurantById(restaurantId, requester);
  return evaluateDelivery(restaurant, latitude, longitude);
}

// Used by order creation. Returns the distance (or null when it can't be measured) and
// throws when the address is measurably outside the restaurant's delivery radius.
// A legacy address saved without coordinates is not blocked here — the UI asks the
// customer to confirm it — so this can only ever reject what it can actually measure.
function assertDeliverable(restaurant, address) {
  if (address.latitude == null || address.longitude == null) return null;
  const { deliverable, distanceKm, radiusKm } = evaluateDelivery(restaurant, address.latitude, address.longitude);
  if (deliverable === false) {
    throw ApiError.badRequest(
      `This restaurant doesn't deliver to that address — it's ${distanceKm} km away and ${restaurant.name} delivers within ${radiusKm} km.`
    );
  }
  return distanceKm;
}

module.exports = { findNearby, listCities, checkDelivery, evaluateDelivery, assertDeliverable, DEFAULT_SEARCH_RADIUS_KM };
