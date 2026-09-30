// Roles that may open the internal admin panel. Mirrors STAFF_ROLES in the backend
// (backend/src/utils/permissions.js). This only decides what the UI shows — the
// backend re-checks a specific permission on every API call, so hiding a link here
// is a convenience, never the security boundary.
export const ADMIN_PANEL_ROLES = [
  'SUPER_ADMIN',
  'ADMIN',
  'OPERATIONS_MANAGER',
  'RESTAURANT_MANAGER',
  'DELIVERY_MANAGER',
  'SUPPORT_AGENT',
];

export function isAdminPanelUser(user) {
  return Boolean(user) && ADMIN_PANEL_ROLES.includes(user.role);
}

// Where a user belongs immediately after signing in. Staff roles run their own
// console and have no use for the customer storefront, so dropping a restaurant
// owner on the customer home page just makes them hunt for their dashboard.
// Only customers get the storefront as their landing page.
export function landingPathFor(user) {
  if (!user) return '/';
  if (user.role === 'RESTAURANT_OWNER') return '/restaurant/dashboard';
  if (user.role === 'DELIVERY_PARTNER') return '/delivery/dashboard';
  if (isAdminPanelUser(user)) return '/admin/dashboard';
  return '/';
}
