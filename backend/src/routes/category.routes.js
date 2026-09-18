const express = require('express');
const categoryController = require('../controllers/foodCategory.controller');
const { createCategoryValidator, updateCategoryValidator } = require('../validators/foodCategory.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles, optionalAuth } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.get('/', optionalAuth, categoryController.list);
router.get('/:id', categoryController.getById);

router.post(
  '/',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  createCategoryValidator,
  validate,
  categoryController.create
);

router.put(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateCategoryValidator,
  validate,
  categoryController.update
);

router.delete(
  '/:id',
  authenticateUser,
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  categoryController.remove
);

module.exports = router;
