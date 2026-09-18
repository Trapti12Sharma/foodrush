const express = require('express');
const orderController = require('../controllers/order.controller');
const { createOrderValidator, updateStatusValidator, cancelOrderValidator } = require('../validators/order.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticateUser);

router.post('/', createOrderValidator, validate, orderController.createOrder);
router.get('/', orderController.listOrders);
router.get('/:id', orderController.getOrder);
router.patch(
  '/:id/status',
  authorizeRoles(ROLES.RESTAURANT_OWNER, ROLES.ADMIN),
  updateStatusValidator,
  validate,
  orderController.updateStatus
);
router.post('/:id/cancel', cancelOrderValidator, validate, orderController.cancelOrder);

module.exports = router;
