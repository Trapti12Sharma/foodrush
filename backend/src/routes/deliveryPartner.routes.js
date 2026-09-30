const express = require('express');
const deliveryPartnerController = require('../controllers/deliveryPartner.controller');
const {
  createDeliveryPartnerValidator,
  updateDeliveryPartnerValidator,
  availabilityValidator,
  locationValidator,
} = require('../validators/deliveryPartner.validator');
const validate = require('../middleware/validate');
const { authenticateUser, authorizeRoles } = require('../middleware/auth.middleware');
const { ROLES } = require('../utils/constants');

const router = express.Router();

router.use(authenticateUser, authorizeRoles(ROLES.DELIVERY_PARTNER));

/**
 * @swagger
 * /delivery-partners:
 *   post:
 *     summary: Create your delivery partner profile and submit it for KYC review (DELIVERY_PARTNER role only)
 *     description: >
 *       One profile per account — calling this a second time returns 409. Every document required for the
 *       chosen vehicleType must be provided (upload each via POST /uploads/image?purpose=kyc first, then pass
 *       the returned URL here); a bicycle needs no licence/registration. KYC starts at SUBMITTED and the
 *       account at PENDING — nothing here is auto-verified or auto-activated.
 *     tags: [Delivery Partners]
 *     responses:
 *       201: { description: Profile created, pending admin KYC review }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       409: { description: You already have a delivery partner profile }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/', createDeliveryPartnerValidator, validate, deliveryPartnerController.create);

/**
 * @swagger
 * /delivery-partners/me:
 *   get:
 *     summary: View your own delivery partner profile, KYC status and account status
 *     tags: [Delivery Partners]
 *     responses:
 *       200: { description: Your profile }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: No profile created yet }
 *   put:
 *     summary: Update allowed fields of your own profile
 *     description: Cannot change role, kycStatus, accountStatus, availability or currentLocation — those are admin-only or have dedicated endpoints. A partial `documents` update merges with, rather than replaces, what is already on file.
 *     tags: [Delivery Partners]
 *     responses:
 *       200: { description: Updated profile }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: No profile created yet }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.get('/me', deliveryPartnerController.getMe);
router.put('/me', updateDeliveryPartnerValidator, validate, deliveryPartnerController.updateMe);

/**
 * @swagger
 * /delivery-partners/me/availability:
 *   patch:
 *     summary: Go ONLINE or OFFLINE
 *     description: Going ONLINE is refused (400) unless the account is ACTIVE and KYC is VERIFIED, checked fresh on every call — a suspended, rejected or unverified partner can never become reachable this way.
 *     tags: [Delivery Partners]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [availability], properties: { availability: { type: string, enum: [ONLINE, OFFLINE] } } }
 *     responses:
 *       200: { description: Updated profile }
 *       400: { description: Not eligible to go online }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: No profile created yet }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch('/me/availability', availabilityValidator, validate, deliveryPartnerController.setAvailability);

/**
 * @swagger
 * /delivery-partners/me/location:
 *   patch:
 *     summary: Report your current device location
 *     description: >
 *       Foundation only for this milestone — stores the latest real device fix reported by the client (never a
 *       fake/random one). No real-time broadcast or dispatch use of this yet.
 *     tags: [Delivery Partners]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [latitude, longitude]
 *             properties:
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               accuracy: { type: number, description: 'Meters, if the device reports one' }
 *     responses:
 *       200: { description: Updated profile }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { description: No profile created yet }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch('/me/location', locationValidator, validate, deliveryPartnerController.updateLocation);

module.exports = router;
