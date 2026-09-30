const express = require('express');
const { isOnlinePaymentConfigured } = require('../services/payment.service');
const { isPersistentStorage } = require('../services/storage.service');
const { isConfigured: isLocationSearchConfigured } = require('../services/geo.service');
const ApiResponse = require('../utils/ApiResponse');

const router = express.Router();

/**
 * @swagger
 * /config:
 *   get:
 *     summary: Public runtime configuration flags
 *     description: Lets the frontend disable the Online Payment option (rather than offer a dead end) when Razorpay isn't configured server-side.
 *     tags: [Config]
 *     security: []
 *     responses:
 *       200:
 *         description: Config flags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: object, properties: { onlinePaymentsEnabled: { type: boolean }, imageStoragePersistent: { type: boolean }, locationSearchEnabled: { type: boolean } } }
 */
router.get('/', (req, res) => {
  res.json(
    new ApiResponse(200, 'Public config', {
      onlinePaymentsEnabled: isOnlinePaymentConfigured(),
      // false = uploaded images will vanish on restart (production without Cloudinary); the UI warns owners.
      imageStoragePersistent: isPersistentStorage(),
      // false = address search / reverse geocoding is unavailable; the UI falls back to GPS + popular cities.
      locationSearchEnabled: isLocationSearchConfigured(),
    })
  );
});

module.exports = router;
