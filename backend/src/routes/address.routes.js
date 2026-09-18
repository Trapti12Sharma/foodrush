const express = require('express');
const addressController = require('../controllers/address.controller');
const { createAddressValidator, updateAddressValidator } = require('../validators/address.validator');
const validate = require('../middleware/validate');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(authenticateUser);

router.get('/', addressController.list);
router.post('/', createAddressValidator, validate, addressController.create);
router.put('/:id', updateAddressValidator, validate, addressController.update);
router.delete('/:id', addressController.remove);

module.exports = router;
