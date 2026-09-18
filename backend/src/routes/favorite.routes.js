const express = require('express');
const favoriteController = require('../controllers/favorite.controller');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticateUser);

router.get('/', favoriteController.list);
router.post('/:restaurantId', favoriteController.add);
router.delete('/:restaurantId', favoriteController.remove);

module.exports = router;
