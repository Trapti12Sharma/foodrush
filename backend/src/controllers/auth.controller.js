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
  // Reuse the same httpOnly/secure/sameSite the cookie was set with (a
  // mismatch there can fail to actually clear the cookie in some browsers) —
  // but drop maxAge: passing it to clearCookie is deprecated in Express and
  // makes it set a cookie that expires in the future instead of immediately.
  const { maxAge, ...clearOptions } = cookieOptions();
  res.clearCookie(COOKIE_NAME, clearOptions);
  res.status(200).json(new ApiResponse(200, 'Logged out successfully'));
});

const getMe = asyncHandler(async (req, res) => {
  res.status(200).json(new ApiResponse(200, 'Current user', { user: req.user.toSafeObject() }));
});

module.exports = { register, login, logout, getMe };
