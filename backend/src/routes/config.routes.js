const express = require('express');
const { isOnlinePaymentConfigured } = require('../services/payment.service');
const ApiResponse = require('../utils/ApiResponse');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(new ApiResponse(200, 'Public config', { onlinePaymentsEnabled: isOnlinePaymentConfigured() }));
});

module.exports = router;
