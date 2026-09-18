const ApiError = require('./ApiError');
const { ROLES } = require('./constants');

// The one place that decides "is this person allowed to modify this resource" —
// every owner-scoped controller (restaurants, categories, foods, orders) calls this
// instead of re-implementing the same ownerId-vs-req.user check inline.
function assertOwnerOrAdmin(ownerId, requester, message = 'You do not have permission to modify this resource') {
  if (!requester) throw ApiError.unauthorized('Authentication required');
  const isOwner = ownerId && ownerId.toString() === requester._id.toString();
  const isAdmin = requester.role === ROLES.ADMIN;
  if (!isOwner && !isAdmin) throw ApiError.forbidden(message);
}

module.exports = { assertOwnerOrAdmin };
