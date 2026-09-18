const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const authService = require('../services/auth.service');
const { signToken, cookieOptions, COOKIE_NAME } = require('../services/token.service');

const register = asyncHandler(async (req, res) => {
  const user = await authService.registerUser(req.body);
  const token = signToken(user);

  res
    .status(201)
    .cookie(COOKIE_NAME, token, cookieOptions())
    .json(new ApiResponse(201, 'Account created successfully', { user: user.toSafeObject(), token }));
});

const login = asyncHandler(async (req, res) => {
  const user = await authService.loginUser(req.body);
  const token = signToken(user);

  res
    .status(200)
    .cookie(COOKIE_NAME, token, cookieOptions())
    .json(new ApiResponse(200, 'Logged in successfully', { user: user.toSafeObject(), token }));
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  res.status(200).json(new ApiResponse(200, 'Logged out successfully'));
});

const getMe = asyncHandler(async (req, res) => {
  res.status(200).json(new ApiResponse(200, 'Current user', { user: req.user.toSafeObject() }));
});

module.exports = { register, login, logout, getMe };
