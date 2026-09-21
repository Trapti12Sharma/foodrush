const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const geoService = require('../services/geo.service');

const autocomplete = asyncHandler(async (req, res) => {
  const suggestions = await geoService.autocomplete({ input: req.query.q, sessionToken: req.query.sessionToken });
  res.json(new ApiResponse(200, 'Suggestions fetched', { suggestions }));
});

const place = asyncHandler(async (req, res) => {
  const result = await geoService.placeDetails({ placeId: req.params.placeId, sessionToken: req.query.sessionToken });
  res.json(new ApiResponse(200, 'Place fetched', { place: result }));
});

const reverse = asyncHandler(async (req, res) => {
  const result = await geoService.reverseGeocode({ latitude: Number(req.query.lat), longitude: Number(req.query.lng) });
  res.json(new ApiResponse(200, 'Address fetched', { place: result }));
});

module.exports = { autocomplete, place, reverse };
