const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const addressService = require('../services/address.service');

const list = asyncHandler(async (req, res) => {
  const addresses = await addressService.listAddresses(req.user._id);
  res.json(new ApiResponse(200, 'Addresses fetched', { addresses }));
});

const create = asyncHandler(async (req, res) => {
  const address = await addressService.createAddress(req.user._id, req.body);
  res.status(201).json(new ApiResponse(201, 'Address added', { address }));
});

const update = asyncHandler(async (req, res) => {
  const address = await addressService.updateAddress(req.user._id, req.params.id, req.body);
  res.json(new ApiResponse(200, 'Address updated', { address }));
});

const remove = asyncHandler(async (req, res) => {
  await addressService.deleteAddress(req.user._id, req.params.id);
  res.json(new ApiResponse(200, 'Address removed'));
});

module.exports = { list, create, update, remove };
