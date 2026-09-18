const express = require('express');
const reviewController = require('../controllers/review.controller');
const { createReviewValidator, updateReviewValidator } = require('../validators/review.validator');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.post('/', authenticateUser, createReviewValidator, validate, reviewController.createReview);
router.put('/:id', authenticateUser, updateReviewValidator, validate, reviewController.updateReview);
router.delete('/:id', authenticateUser, reviewController.deleteReview);

module.exports = router;
