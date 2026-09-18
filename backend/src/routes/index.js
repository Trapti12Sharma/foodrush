const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/restaurants', require('./restaurant.routes'));
router.use('/categories', require('./category.routes'));
router.use('/foods', require('./food.routes'));
router.use('/cart', require('./cart.routes'));
router.use('/addresses', require('./address.routes'));
router.use('/orders', require('./order.routes'));
router.use('/coupons', require('./coupon.routes'));
router.use('/config', require('./config.routes'));
router.use('/admin', require('./admin.routes'));

// Further resource routers are mounted here as each phase adds them,
// e.g. router.use('/reviews', require('./review.routes'));

router.get('/', (req, res) => {
  res.json({ success: true, message: 'FoodRush API root', data: { version: '1.0.0' } });
});

module.exports = router;
