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
