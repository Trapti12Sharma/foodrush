const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const deliveryPartnerService = require('../services/deliveryPartner.service');

const create = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.createProfile(req.user, req.body);
  res
    .status(201)
    .json(new ApiResponse(201, 'Delivery partner profile created and submitted for KYC review', { deliveryPartner: partner }));
});

const getMe = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.getMyProfile(req.user);
  res.json(new ApiResponse(200, 'Your delivery partner profile', { deliveryPartner: partner }));
});

const updateMe = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.updateMyProfile(req.user, req.body);
  res.json(new ApiResponse(200, 'Profile updated', { deliveryPartner: partner }));
});

const setAvailability = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.setAvailability(req.user, req.body.availability);
  res.json(new ApiResponse(200, 'Availability updated', { deliveryPartner: partner }));
});

const updateLocation = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.updateMyLocation(req.user, req.body);
  res.json(new ApiResponse(200, 'Location updated', { deliveryPartner: partner }));
});

module.exports = { create, getMe, updateMe, setAvailability, updateLocation };
