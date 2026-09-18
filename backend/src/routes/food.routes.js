const express = require('express');
const foodController = require('../controllers/foodItem.controller');
const { createFoodValidator, updateFoodValidator } = require('../validators/foodItem.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles, optionalAuth } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.get('/', optionalAuth, foodController.list);
router.get('/:id', optionalAuth, foodController.getById);

router.post(
  '/',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  createFoodValidator,
  validate,
  foodController.create
);

router.put(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateFoodValidator,
  validate,
  foodController.update
);

router.delete(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  foodController.remove
);

module.exports = router;
