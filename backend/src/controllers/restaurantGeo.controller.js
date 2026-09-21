const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const restaurantGeoService = require('../services/restaurantGeo.service');

const nearby = asyncHandler(async (req, res) => {
  const { items, pagination, searchedFrom } = await restaurantGeoService.findNearby(req.query);
  res.json(new ApiResponse(200, 'Nearby restaurants fetched', { restaurants: items, pagination, searchedFrom }));
});

const cities = asyncHandler(async (req, res) => {
  res.json(new ApiResponse(200, 'Cities fetched', { cities: await restaurantGeoService.listCities() }));
});

const deliveryCheck = asyncHandler(async (req, res) => {
  const result = await restaurantGeoService.checkDelivery(req.params.id, Number(req.body.latitude), Number(req.body.longitude), req.user);
  res.json(new ApiResponse(200, 'Delivery checked', result));
});

module.exports = { nearby, cities, deliveryCheck };
