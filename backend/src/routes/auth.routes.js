const express = require('express');
const authController = require('../controllers/auth.controller');
const { registerValidator, loginValidator } = require('../validators/auth.validator');
const {
  updateProfileValidator,
  changePasswordValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
} = require('../validators/profile.validator');
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

/**
 * @swagger
 * /auth/me:
 *   put:
 *     summary: Update your own profile
 *     description: >
 *       Whitelisted fields only (name, phone, avatar, email) — role and account status can never be set here.
 *       Changing the email also requires `currentPassword`. `avatar` must be an uploaded image path or an https URL;
 *       send an empty string to remove it.
 *     tags: [Auth]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string, maxLength: 100 }
 *               phone: { type: string, example: '+91 98765 43210' }
 *               avatar: { type: string, example: /uploads/1700000000-ab12cd.png }
 *               email: { type: string, format: email }
 *               currentPassword: { type: string, description: Required only when changing the email }
 *     responses:
 *       200: { description: The updated user }
 *       400: { description: Wrong current password (when changing email) }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       409: { description: That email is already in use }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.put('/me', authenticateUser, updateProfileValidator, validate, authController.updateMe);

/**
 * @swagger
 * /auth/change-password:
 *   post:
 *     summary: Change your password
 *     description: Requires the current password. All other sessions are signed out; this device gets a fresh session cookie.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8, maxLength: 72 }
 *     responses:
 *       200: { description: Password changed }
 *       400: { description: Wrong current password, or new password equals the old one }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Too many attempts }
 */
router.post('/change-password', authLimiter, authenticateUser, changePasswordValidator, validate, authController.changePassword);

/**
 * @swagger
 * /auth/forgot-password:
 *   post:
 *     summary: Request a password-reset email
 *     description: >
 *       Always responds 200 with the same message, whether or not the email is registered, so accounts cannot be
 *       discovered. If it is registered (and active) a single-use link valid for 30 minutes is emailed; at most one
 *       email per minute per account.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Generic acknowledgement }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Too many attempts }
 */
router.post('/forgot-password', authLimiter, forgotPasswordValidator, validate, authController.forgotPassword);

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Set a new password using an emailed reset token
 *     description: The token is single-use and expires after 30 minutes. Signs out every existing session.
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token: { type: string, description: The 64-character token from the emailed link }
 *               password: { type: string, minLength: 8, maxLength: 72 }
 *     responses:
 *       200: { description: Password reset }
 *       400: { description: Invalid or expired token }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Too many attempts }
 */
router.post('/reset-password', authLimiter, resetPasswordValidator, validate, authController.resetPassword);

module.exports = router;
