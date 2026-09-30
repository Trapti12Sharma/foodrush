const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const notificationPreferenceService = require('../services/notificationPreference.service');

// Identity always comes from authenticateUser (req.user) — there is no way to
// read or write anyone else's preferences through this controller.
const getMyPreferences = asyncHandler(async (req, res) => {
  const preferences = await notificationPreferenceService.getForUser(req.user);
  res.json(new ApiResponse(200, 'Notification preferences fetched', { preferences }));
});

const updateMyPreferences = asyncHandler(async (req, res) => {
  const preferences = await notificationPreferenceService.updateForUser(req.user, req.body);
  res.json(new ApiResponse(200, 'Notification preferences updated', { preferences }));
});

module.exports = { getMyPreferences, updateMyPreferences };
