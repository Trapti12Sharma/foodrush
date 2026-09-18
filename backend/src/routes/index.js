const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/restaurants', require('./restaurant.routes'));
router.use('/categories', require('./category.routes'));
router.use('/foods', require('./food.routes'));
router.use('/cart', require('./cart.routes'));

// Further resource routers are mounted here as each phase adds them,
// e.g. router.use('/orders', require('./order.routes'));

router.get('/', (req, res) => {
  res.json({ success: true, message: 'FoodRush API root', data: { version: '1.0.0' } });
});

module.exports = router;
