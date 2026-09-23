const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const User = require('../models/User');
const { verifyToken, COOKIE_NAME } = require('../services/token.service');
const { ROLES } = require('../utils/constants');
const { hasPermission } = require('../utils/permissions');

function extractToken(req) {
  if (req.cookies && req.cookies[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// A token issued before the user's last password change is no longer valid. JWT
// `iat` has one-second resolution, so compare in whole seconds.
function isRevoked(payload, user) {
  if (!user.passwordChangedAt) return false;
  return payload.iat < Math.floor(user.passwordChangedAt.getTime() / 1000);
}

// The single place that turns a raw JWT into a trusted, live User document —
// shared by the HTTP middleware below AND the Socket.IO auth middleware
// (realtime/socketAuth.js), so a deactivated account or role change takes effect
// identically and immediately on both transports, not just HTTP. Throws
// ApiError.unauthorized (never a raw jsonwebtoken error) on any failure, and
// never leaks which specific check failed.
async function resolveUserFromToken(token) {
  if (!token) throw ApiError.unauthorized('Authentication required');
  const payload = verifyToken(token); // throws JsonWebTokenError/TokenExpiredError
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive || isRevoked(payload, user)) {
    throw ApiError.unauthorized('Session expired. Please login again.');
  }
  return user;
}

const authenticateUser = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  req.user = await resolveUserFromToken(token); // JWT errors -> errorHandler via asyncHandler
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

// Restricts a route to users holding EVERY listed permission. Prefer this over
// authorizeRoles for anything platform-wide (admin/staff features) — see
// utils/permissions.js. Like authorizeRoles it never checks resource ownership.
const requirePermission = (...permissions) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (!permissions.every((permission) => hasPermission(req.user, permission))) {
    return next(ApiError.forbidden('You do not have permission to perform this action'));
  }
  next();
};

// For routes a restaurant owner may use on their OWN resources and platform staff
// may use on ANY resource: passes for owners, or for anyone holding `permission`.
// The per-resource ownership check still happens in the service.
const requireOwnerOrPermission = (permission) => (req, res, next) => {
  if (!req.user) return next(ApiError.unauthorized('Authentication required'));
  if (req.user.role === ROLES.RESTAURANT_OWNER || hasPermission(req.user, permission)) return next();
  next(ApiError.forbidden('You do not have permission to perform this action'));
};

// For public browse endpoints (restaurant/menu listings) that behave slightly
// differently for a logged-in owner/admin (e.g. revealing their own unapproved
// restaurant) but must never reject an anonymous visitor. Invalid/expired tokens
// are silently ignored here rather than raising 401 — the route stays public.
const optionalAuth = asyncHandler(async (req, res, next) => {
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (user && user.isActive && !isRevoked(payload, user)) req.user = user;
  } catch (err) {
    // ignore — anonymous request
  }
  next();
});

module.exports = {
  authenticateUser,
  authorizeRoles,
  requirePermission,
  requireOwnerOrPermission,
  optionalAuth,
  resolveUserFromToken,
};
