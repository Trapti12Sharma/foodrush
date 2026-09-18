const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, process.env.UPLOAD_DIR || 'uploads'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(ApiError.badRequest('Only JPEG, PNG, and WEBP images are allowed'));
  }
  cb(null, true);
}

const maxSizeBytes = (Number(process.env.MAX_UPLOAD_SIZE_MB) || 5) * 1024 * 1024;

const upload = multer({ storage, fileFilter, limits: { fileSize: maxSizeBytes } });

// Wraps multer's callback-based error handling so a bad upload (wrong type,
// too large) reaches the centralized errorHandler as a normal ApiError instead
// of an unhandled MulterError.
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
      next();
    });
  };
}

module.exports = { uploadSingleImage };
