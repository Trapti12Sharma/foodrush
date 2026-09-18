const express = require('express');
const cartController = require('../controllers/cart.controller');
const { addItemValidator, updateItemValidator } = require('../validators/cart.validator');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticateUser);

router.get('/', cartController.getCart);
router.post('/items', addItemValidator, validate, cartController.addItem);
router.put('/items/:id', updateItemValidator, validate, cartController.updateItem);
router.delete('/items/:id', cartController.removeItem);
router.delete('/', cartController.clearCart);

module.exports = router;
