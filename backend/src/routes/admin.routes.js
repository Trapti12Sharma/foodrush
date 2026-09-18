const express = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticateUser, authorizeRoles(ROLES.ADMIN));

router.get('/dashboard', adminController.getDashboard);

router.get('/users', adminController.listUsers);
router.patch('/users/:id/status', [body('isActive').isBoolean()], validate, adminController.setUserActive);

router.get('/restaurants', adminController.listRestaurants);
router.patch('/restaurants/:id/approve', adminController.approveRestaurant);
router.patch('/restaurants/:id/status', [body('isActive').isBoolean()], validate, adminController.setRestaurantActive);

router.get('/orders', adminController.listOrders);

module.exports = router;
