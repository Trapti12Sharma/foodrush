const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { ROLES } = require('../utils/constants');
const { PERMISSIONS, hasPermission } = require('../utils/permissions');
const { detectImageType } = require('../utils/imageUrl');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// What an upload is FOR decides who may do it. Profile photos are open to any signed-in
// user; catalog images (restaurant, food, category) only to restaurant owners and the
// staff who manage restaurants — so a customer account can't be used as free image hosting.
const PURPOSES = Object.freeze(['avatar', 'restaurant', 'food', 'category']);
const DEFAULT_PURPOSE = 'avatar';

// Checked BEFORE multer runs, so an unauthorised request never gets its file buffered.
function authorizeUpload(req, res, next) {
  const purpose = req.query.purpose || DEFAULT_PURPOSE;
  if (!PURPOSES.includes(purpose)) {
    return next(ApiError.badRequest(`purpose must be one of: ${PURPOSES.join(', ')}`));
  }
  const mayUploadCatalogImages = req.user.role === ROLES.RESTAURANT_OWNER || hasPermission(req.user, PERMISSIONS.RESTAURANTS_MANAGE);
  if (purpose !== 'avatar' && !mayUploadCatalogImages) {
    return next(ApiError.forbidden('You do not have permission to upload this kind of image'));
  }
  req.uploadPurpose = purpose;
  next();
}

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(ApiError.badRequest('Only JPEG, PNG, and WEBP images are allowed'));
  }
  cb(null, true);
}

const maxSizeBytes = (Number(process.env.MAX_UPLOAD_SIZE_MB) || 5) * 1024 * 1024;

// Always in memory (bounded by the size limit): the bytes are inspected before anything
// is stored, then handed to the storage service — Cloudinary, or a local file in dev.
const upload = multer({ storage: multer.memoryStorage(), fileFilter, limits: { fileSize: maxSizeBytes, files: 1 } });

// Wraps multer's callback-based error handling so a bad upload (wrong type,
// too large) reaches the centralized errorHandler as a normal ApiError instead
// of an unhandled MulterError, then verifies the file really is the image it claims to be.
function uploadSingleImage(fieldName) {
  const middleware = upload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return next(ApiError.badRequest(`File too large. Max size is ${process.env.MAX_UPLOAD_SIZE_MB || 5}MB`));
        }
        return next(ApiError.badRequest(err.message));
      }
      if (err) return next(err);

      if (req.file) {
        // The Content-Type header and file extension are client-controlled; the bytes are not.
        const detectedType = detectImageType(req.file.buffer);
        if (!detectedType) return next(ApiError.badRequest('That file is not a valid JPEG, PNG, or WEBP image'));
        req.file.detectedType = detectedType;
      }
      next();
    });
  };
}

module.exports = { uploadSingleImage, authorizeUpload, PURPOSES };
