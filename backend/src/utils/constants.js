// ADMIN is kept as-is (existing accounts use it) and has exactly the powers it
// always had; SUPER_ADMIN adds audit-log access and admin management on top.
// The remaining roles are defined now so RBAC is complete — their permissions
// live in permissions.js. Self-registration is still limited to CUSTOMER and
// RESTAURANT_OWNER (auth.validator.js); staff roles are assigned by a super admin.
const ROLES = Object.freeze({
  CUSTOMER: 'CUSTOMER',
  RESTAURANT_OWNER: 'RESTAURANT_OWNER',
  DELIVERY_PARTNER: 'DELIVERY_PARTNER',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPERATIONS_MANAGER: 'OPERATIONS_MANAGER',
  RESTAURANT_MANAGER: 'RESTAURANT_MANAGER',
  DELIVERY_MANAGER: 'DELIVERY_MANAGER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
});

const ORDER_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  PREPARING: 'preparing',
  READY_FOR_PICKUP: 'ready_for_pickup',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
});

// Explicit allow-list of forward transitions. Anything not listed here is invalid —
// enforced in the order service (Phase 8), not just the UI.
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PENDING]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.REJECTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY_FOR_PICKUP]: [ORDER_STATUS.OUT_FOR_DELIVERY],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REJECTED]: [],
});

const PAYMENT_METHODS = Object.freeze({
  COD: 'COD',
  ONLINE: 'ONLINE',
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  PAID: 'paid',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

const DISCOUNT_TYPES = Object.freeze({
  PERCENTAGE: 'PERCENTAGE',
  FLAT: 'FLAT',
});

module.exports = {
  ROLES,
  ORDER_STATUS,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  DISCOUNT_TYPES,
};
