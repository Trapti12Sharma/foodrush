const express = require('express');
const uploadController = require('../controllers/upload.controller');
const { uploadSingleImage } = require('../middleware/upload.middleware');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/image', authenticateUser, uploadSingleImage('image'), uploadController.uploadImage);

module.exports = router;
