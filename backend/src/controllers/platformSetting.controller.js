const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const platformSettingService = require('../services/platformSetting.service');

// M17 — thin, like every controller here: the service owns the concurrency check,
// the allow-list of editable paths and the audit entry.

// The response deliberately includes `version`, because the client has to send it
// back on the next PATCH for the optimistic-concurrency check to work.
const getSettings = asyncHandler(async (req, res) => {
  const settings = await platformSettingService.getSettings();
  res.json(new ApiResponse(200, 'Platform settings', { settings }));
});

const updateSettings = asyncHandler(async (req, res) => {
  const { version, ...patch } = req.body;
  const settings = await platformSettingService.updateSettings(patch, version, { actor: req.user, req });
  res.json(new ApiResponse(200, 'Platform settings updated', { settings }));
});

module.exports = { getSettings, updateSettings };
