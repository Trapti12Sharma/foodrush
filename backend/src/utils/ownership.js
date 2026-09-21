const ApiError = require('./ApiError');
const { PERMISSIONS, hasPermission } = require('./permissions');

// The one place that decides "is this person allowed to modify this resource" —
// every owner-scoped controller (restaurants, categories, foods, orders) calls this
// instead of re-implementing the same ownerId-vs-req.user check inline.
//
// The requester passes if they own the resource, or hold the platform-wide
// `permission` (by default RESTAURANTS_MANAGE — held by ADMIN, SUPER_ADMIN and
// RESTAURANT_MANAGER). The name is historical: it no longer means "role ADMIN".
function assertOwnerOrAdmin(
  ownerId,
  requester,
  message = 'You do not have permission to modify this resource',
  permission = PERMISSIONS.RESTAURANTS_MANAGE
) {
  if (!requester) throw ApiError.unauthorized('Authentication required');
  const isOwner = ownerId && ownerId.toString() === requester._id.toString();
  if (!isOwner && !hasPermission(requester, permission)) throw ApiError.forbidden(message);
}

module.exports = { assertOwnerOrAdmin };
