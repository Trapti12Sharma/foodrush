const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const storageService = require('../services/storage.service');

const uploadImage = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');
  const { url } = await storageService.saveUploadedFile(req.file);
  res.status(201).json(new ApiResponse(201, 'Image uploaded', { url }));
});

module.exports = { uploadImage };
