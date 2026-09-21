const express = require('express');
const uploadController = require('../controllers/upload.controller');
const { uploadSingleImage, authorizeUpload } = require('../middleware/upload.middleware');
const { uploadLimiter } = require('../middleware/rateLimiter');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * @swagger
 * /uploads/image:
 *   post:
 *     summary: Upload an image, get back a URL to use as an `image`/`avatar` field
 *     description: >
 *       Stored permanently on Cloudinary when CLOUDINARY_* is configured, otherwise on local disk
 *       (development only — ephemeral on Render). Only real JPEG/PNG/WEBP files are accepted (the file's
 *       bytes are checked, not just its extension), up to MAX_UPLOAD_SIZE_MB (default 5MB).
 *       `purpose` decides who may upload: `avatar` (default) is open to any signed-in user;
 *       `restaurant`, `food` and `category` require a restaurant owner or restaurant-management staff.
 *       Rate-limited.
 *     tags: [Uploads]
 *     parameters:
 *       - in: query
 *         name: purpose
 *         schema: { type: string, enum: [avatar, restaurant, food, category], default: avatar }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [image]
 *             properties:
 *               image: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Uploaded
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { url: { type: string, example: 'https://res.cloudinary.com/<cloud>/image/upload/v1/foodrush/food/<userId>/<id>.jpg' } } } } }
 *       400: { description: 'No file, not a real image, wrong purpose, or file too large' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       429: { description: Too many uploads }
 *       502: { description: Image storage provider unavailable }
 */
router.post('/image', uploadLimiter, authenticateUser, authorizeUpload, uploadSingleImage('image'), uploadController.uploadImage);

module.exports = router;
