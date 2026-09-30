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
// M17 — platform settings and the super-admin staff console are separate concerns
// with their own permissions, so they get their own routers on the shared /admin
// prefix rather than growing admin.routes.js further (the same split
// deliveryEarning.routes.js already uses under /delivery-partners). None of their
// paths overlap admin.routes.js, so mount order is not significant.
router.use('/admin', require('./adminSettings.routes'));
router.use('/admin', require('./adminStaff.routes'));
router.use('/reviews', require('./review.routes'));
router.use('/favorites', require('./favorite.routes'));
router.use('/uploads', require('./upload.routes'));
router.use('/geo', require('./geo.routes'));
router.use('/delivery-partners', require('./deliveryPartner.routes'));
router.use('/delivery-partners', require('./deliveryEarning.routes'));
router.use('/delivery-assignments', require('./deliveryAssignment.routes'));
router.use('/support', require('./support.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/notification-preferences', require('./notificationPreference.routes'));

router.get('/', (req, res) => {
  res.json({ success: true, message: 'FoodRush API root', data: { version: '1.0.0' } });
});

module.exports = router;
