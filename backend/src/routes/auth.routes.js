const express = require('express');
const authController = require('../controllers/auth.controller');
const { registerValidator, loginValidator } = require('../validators/auth.validator');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');
const { authenticateUser } = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Register a new account
 *     description: Public role is limited to CUSTOMER or RESTAURANT_OWNER — ADMIN accounts can never be created through this endpoint.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               password: { type: string, minLength: 8 }
 *               role: { type: string, enum: [CUSTOMER, RESTAURANT_OWNER], default: CUSTOMER }
 *     responses:
 *       201:
 *         description: Account created; auth cookie set
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/User' }
 *                     token: { type: string, description: 'Same JWT also set as an httpOnly cookie' }
 *       409:
 *         description: Email already registered
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/register', authLimiter, registerValidator, validate, authController.register);

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Log in with email and password
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200:
 *         description: Logged in; auth cookie set
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     user: { $ref: '#/components/schemas/User' }
 *                     token: { type: string }
 *       401:
 *         description: Invalid email or password (same message for both, to avoid leaking which is wrong)
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       403:
 *         description: Account has been disabled
 *         content: { application/json: { schema: { $ref: '#/components/schemas/ApiError' } } }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post('/login', authLimiter, loginValidator, validate, authController.login);

/**
 * @swagger
 * /auth/logout:
 *   post:
 *     summary: Log out (clears the auth cookie)
 *     tags: [Auth]
 *     security: []
 *     responses:
 *       200: { description: Logged out }
 */
router.post('/logout', authController.logout);

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Get the currently authenticated user
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: The current user
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: object, properties: { user: { $ref: '#/components/schemas/User' } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 */
router.get('/me', authenticateUser, authController.getMe);

module.exports = router;
