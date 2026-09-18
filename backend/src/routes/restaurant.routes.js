const express = require('express');
const restaurantController = require('../controllers/restaurant.controller');
const { createRestaurantValidator, updateRestaurantValidator } = require('../validators/restaurant.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles, optionalAuth } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.get('/', restaurantController.list);
router.get('/mine', authenticateUser, authorizeRoles(ROLES.RESTAURANT_OWNER), restaurantController.listMine);
router.get('/:id', optionalAuth, restaurantController.getById);

router.post(
  '/',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER),
  createRestaurantValidator,
  validate,
  restaurantController.create
);

router.put(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateRestaurantValidator,
  validate,
  restaurantController.update
);

router.delete(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  restaurantController.remove
);

module.exports = router;
