const express = require('express');
const uploadController = require('../controllers/upload.controller');
const { uploadSingleImage } = require('../middleware/upload.middleware');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * @swagger
 * /uploads/image:
 *   post:
 *     summary: Upload an image, get back a URL to use as a restaurant/category/food `image` field
 *     description: >
 *       Local disk storage today (served back from /uploads/<file>); the same
 *       {url} response shape is what a future Cloudinary/S3 swap would return,
 *       so no caller needs to change. Only jpeg/png/webp are accepted, up to
 *       MAX_UPLOAD_SIZE_MB (default 5MB).
 *     tags: [Uploads]
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
 *             schema: { type: object, properties: { data: { type: object, properties: { url: { type: string, example: /uploads/1700000000000-a1b2c3.png } } } } }
 *       400: { description: 'No file, wrong file type, or file too large' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.post('/image', authenticateUser, uploadSingleImage('image'), uploadController.uploadImage);

module.exports = router;
