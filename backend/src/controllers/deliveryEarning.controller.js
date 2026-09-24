const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const deliveryPartnerService = require('../services/deliveryPartner.service');
const deliveryEarningService = require('../services/deliveryEarning.service');

// Every handler resolves the caller's OWN DeliveryPartner profile first (404 if
// they haven't created one) — every earning is scoped to that profile, never to
// req.user or any id supplied by the client.
const myEarnings = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  const { items, pagination, summary } = await deliveryEarningService.listForRider(rider, req.query);
  res.json(new ApiResponse(200, 'Your earnings', { items, pagination, summary }));
});

const myEarningById = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  const earning = await deliveryEarningService.getForRider(rider, req.params.id);
  res.json(new ApiResponse(200, 'Earning fetched', { earning }));
});

module.exports = { myEarnings, myEarningById };
