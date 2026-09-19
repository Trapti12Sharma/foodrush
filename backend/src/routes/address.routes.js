const express = require('express');
const addressController = require('../controllers/address.controller');
const { createAddressValidator, updateAddressValidator } = require('../validators/address.validator');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /addresses:
 *   get:
 *     summary: List the signed-in customer's saved addresses
 *     tags: [Addresses]
 *     responses:
 *       200:
 *         description: Addresses, default-first
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { addresses: { type: array, items: { $ref: '#/components/schemas/Address' } } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/', addressController.list);

/**
 * @swagger
 * /addresses:
 *   post:
 *     summary: Add a new address
 *     description: The very first address a customer adds is automatically made default.
 *     tags: [Addresses]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [addressLine, city, pincode]
 *             properties:
 *               label: { type: string, example: Home }
 *               addressLine: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               isDefault: { type: boolean }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { address: { $ref: '#/components/schemas/Address' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/', createAddressValidator, validate, addressController.create);

/**
 * @swagger
 * /addresses/{id}:
 *   put:
 *     summary: Update one of the signed-in customer's own addresses
 *     description: Setting isDefault=true clears the default flag on every other address of this customer.
 *     tags: [Addresses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label: { type: string }
 *               addressLine: { type: string }
 *               city: { type: string }
 *               state: { type: string }
 *               pincode: { type: string }
 *               latitude: { type: number }
 *               longitude: { type: number }
 *               isDefault: { type: boolean }
 *     responses:
 *       200:
 *         description: Updated
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { address: { $ref: '#/components/schemas/Address' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.put('/:id', updateAddressValidator, validate, addressController.update);

/**
 * @swagger
 * /addresses/{id}:
 *   delete:
 *     summary: Delete one of the signed-in customer's own addresses
 *     description: If the deleted address was the default, the most recently created remaining address becomes default.
 *     tags: [Addresses]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.delete('/:id', addressController.remove);

module.exports = router;
