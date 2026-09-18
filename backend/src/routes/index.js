const express = require('express');

const router = express.Router();

// Individual resource routers are mounted here as each phase adds them,
// e.g. router.use('/auth', require('./auth.routes'));

router.get('/', (req, res) => {
  res.json({ success: true, message: 'FoodRush API root', data: { version: '1.0.0' } });
});

module.exports = router;
