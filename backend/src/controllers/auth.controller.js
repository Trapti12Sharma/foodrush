const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const authService = require('../services/auth.service');
const auditService = require('../services/audit.service');
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

const updateMe = asyncHandler(async (req, res) => {
  const { user, emailChanged } = await authService.updateProfile(req.user._id, req.body);
  if (emailChanged) {
    await auditService.record({ req, action: 'auth.email_change', entityType: 'User', entityId: user._id });
  }
  res.status(200).json(new ApiResponse(200, 'Profile updated', { user: user.toSafeObject() }));
});

// Re-issues the session cookie: the change revoked every older token (including
// the one that made this request), so the current device gets a fresh one.
const changePassword = asyncHandler(async (req, res) => {
  const user = await authService.changePassword(req.user._id, req.body);
  await auditService.record({ req, action: 'auth.password_change', entityType: 'User', entityId: user._id });
  res
    .status(200)
    .cookie(COOKIE_NAME, signToken(user), cookieOptions())
    .json(new ApiResponse(200, 'Password changed. Other devices have been signed out.', { user: user.toSafeObject() }));
});

// One generic answer for every input — registered or not, active or not, rate-limited
// or not — so the endpoint can't be used to discover which emails have accounts.
const forgotPassword = asyncHandler(async (req, res) => {
  await authService.requestPasswordReset(req.body.email);
  res.status(200).json(new ApiResponse(200, 'If an account exists for that email, a reset link has been sent.'));
});

const resetPassword = asyncHandler(async (req, res) => {
  const user = await authService.resetPassword(req.body);
  await auditService.record({ req, actor: user, action: 'auth.password_reset', entityType: 'User', entityId: user._id });
  res.status(200).json(new ApiResponse(200, 'Password reset. You can now log in with your new password.'));
});

module.exports = { register, login, logout, getMe, updateMe, changePassword, forgotPassword, resetPassword };
