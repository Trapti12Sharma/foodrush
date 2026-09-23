const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const deliveryPartnerService = require('../services/deliveryPartner.service');
const deliveryAssignmentService = require('../services/deliveryAssignment.service');

// Every handler here first resolves the caller's OWN DeliveryPartner profile
// (404 if they haven't created one) — every assignment operation is scoped to
// that profile, never to req.user directly.
const myOffers = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  const offers = await deliveryAssignmentService.currentOffersForRider(rider);
  res.json(new ApiResponse(200, 'Your current delivery offers', { offers }));
});

const myCurrentDelivery = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  const assignment = await deliveryAssignmentService.currentDeliveryForRider(rider);
  res.json(new ApiResponse(200, 'Your current delivery', { assignment }));
});

const myAssignments = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  const { items, pagination } = await deliveryAssignmentService.listForRider(rider, req.query);
  res.json(new ApiResponse(200, 'Your delivery assignments', { assignments: items, pagination }));
});

const accept = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  await deliveryAssignmentService.assertOwnAssignment(rider, req.params.id);
  const { assignment, order } = await deliveryAssignmentService.acceptAssignment(rider, req.params.id);
  res.json(new ApiResponse(200, 'Delivery accepted', { assignment, order }));
});

const reject = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  await deliveryAssignmentService.assertOwnAssignment(rider, req.params.id);
  const assignment = await deliveryAssignmentService.rejectAssignment(rider, req.params.id, req.body.reason);
  res.json(new ApiResponse(200, 'Delivery declined', { assignment }));
});

const verifyOtp = asyncHandler(async (req, res) => {
  const rider = await deliveryPartnerService.getMyProfile(req.user);
  const { order, assignment } = await deliveryAssignmentService.verifyDeliveryOtp(rider, req.params.id, req.body.otp);
  res.json(new ApiResponse(200, 'Delivery completed', { order, assignment }));
});

module.exports = { myOffers, myCurrentDelivery, myAssignments, accept, reject, verifyOtp };
