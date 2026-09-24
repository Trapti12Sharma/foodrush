const { ROLES } = require('./constants');

// Permission-based authorization. Routes and services ask "may this user do X?"
// rather than "is this user an ADMIN?", so adding a staff role later is a change
// to the table below, not a hunt through the codebase for `role === 'ADMIN'`.
//
// Resource-scoped roles (RESTAURANT_OWNER, DELIVERY_PARTNER, CUSTOMER) have no
// platform-wide permissions on purpose: what they may touch is decided by an
// ownership check on the specific record (see ownership.js), never by role alone.
const PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: 'dashboard:view',
  USERS_READ: 'users:read',
  USERS_MANAGE: 'users:manage',
  RESTAURANTS_READ_ALL: 'restaurants:read_all', // see unapproved/inactive restaurants
  RESTAURANTS_APPROVE: 'restaurants:approve',
  RESTAURANTS_MANAGE: 'restaurants:manage', // enable/disable, edit any restaurant or its menu
  ORDERS_READ_ALL: 'orders:read_all',
  ORDERS_MANAGE: 'orders:manage', // change status of / cancel any order
  COUPONS_MANAGE: 'coupons:manage',
  REVIEWS_MODERATE: 'reviews:moderate',
  AUDIT_READ: 'audit:read',
  ADMINS_MANAGE: 'admins:manage', // change status of staff accounts
  SETTINGS_MANAGE: 'settings:manage',
  REFUNDS_MANAGE: 'refunds:manage',
  DELIVERY_PARTNERS_MANAGE: 'delivery_partners:manage', // view KYC details, approve/reject KYC, suspend/reactivate
  DELIVERY_ASSIGNMENTS_MANAGE: 'delivery_assignments:manage', // view/cancel assignments, manually dispatch a rider
  DELIVERY_SETTLEMENTS_MANAGE: 'delivery_settlements:manage', // generate/approve/mark paid or failed
});

const P = PERMISSIONS;

// ADMIN's set is exactly what the old `role === 'ADMIN'` checks allowed, so
// existing admin accounts behave identically after this change.
const ADMIN_PERMISSIONS = [
  P.DASHBOARD_VIEW,
  P.USERS_READ,
  P.USERS_MANAGE,
  P.RESTAURANTS_READ_ALL,
  P.RESTAURANTS_APPROVE,
  P.RESTAURANTS_MANAGE,
  P.ORDERS_READ_ALL,
  P.ORDERS_MANAGE,
  P.COUPONS_MANAGE,
  P.REVIEWS_MODERATE,
  P.REFUNDS_MANAGE,
  P.DELIVERY_PARTNERS_MANAGE,
  P.DELIVERY_ASSIGNMENTS_MANAGE,
  P.DELIVERY_SETTLEMENTS_MANAGE,
];

const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.SUPER_ADMIN]: Object.values(PERMISSIONS),
  [ROLES.ADMIN]: ADMIN_PERMISSIONS,
  [ROLES.OPERATIONS_MANAGER]: [P.DASHBOARD_VIEW, P.USERS_READ, P.RESTAURANTS_READ_ALL, P.ORDERS_READ_ALL, P.ORDERS_MANAGE],
  [ROLES.RESTAURANT_MANAGER]: [
    P.DASHBOARD_VIEW,
    P.RESTAURANTS_READ_ALL,
    P.RESTAURANTS_APPROVE,
    P.RESTAURANTS_MANAGE,
    P.REVIEWS_MODERATE,
  ],
  [ROLES.DELIVERY_MANAGER]: [
    P.DASHBOARD_VIEW,
    P.ORDERS_READ_ALL,
    P.DELIVERY_PARTNERS_MANAGE,
    P.DELIVERY_ASSIGNMENTS_MANAGE,
    P.DELIVERY_SETTLEMENTS_MANAGE,
  ],
  [ROLES.SUPPORT_AGENT]: [P.DASHBOARD_VIEW, P.USERS_READ, P.ORDERS_READ_ALL],
  [ROLES.RESTAURANT_OWNER]: [],
  [ROLES.DELIVERY_PARTNER]: [],
  [ROLES.CUSTOMER]: [],
});

// Roles that belong to the FoodRush team (as opposed to customers, restaurant
// owners and delivery partners, who are external users of the platform).
const STAFF_ROLES = Object.freeze([
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.OPERATIONS_MANAGER,
  ROLES.RESTAURANT_MANAGER,
  ROLES.DELIVERY_MANAGER,
  ROLES.SUPPORT_AGENT,
]);

function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

function isStaffRole(role) {
  return STAFF_ROLES.includes(role);
}

// `user` may be undefined (anonymous request) — that simply has no permissions.
function hasPermission(user, permission) {
  return Boolean(user) && getPermissions(user.role).includes(permission);
}

module.exports = { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES, getPermissions, isStaffRole, hasPermission };
