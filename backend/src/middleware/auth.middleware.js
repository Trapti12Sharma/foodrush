const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const { verifyToken, COOKIE_NAME } = require('../services/token.service');

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Verifies the JWT, then re-loads the user from the DB (not just trusting the
// token payload) so a deactivated account or role change takes effect immediately
// instead of waiting for the token to expire.
const authenticateUser = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required');

  const payload = verifyToken(token); // throws JsonWebTokenError/TokenExpiredError -> errorHandler
  const user = await User.findById(payload.sub);

  if (!user || !user.isActive) {
    throw ApiError.unauthorized('Session expired. Please login again.');
  }

  req.user = user;
  next();
});

// Restricts a route to specific roles. Ownership checks (e.g. "this is YOUR
// restaurant") are a separate, per-resource concern handled in each service —
// this middleware only checks the role class, never resource ownership.
const authorizeRoles = (...roles) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (!roles.includes(req.user.role)) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  next();
};

module.exports = { authenticateUser, authorizeRoles };
