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

// Uppercase, matching the platform-wide convention (roles, permissions, payment
// methods). PLACED replaces the original PENDING — clearer once orders also have a
// separate, lowercase paymentStatus of their own ("pending" no longer means two
// different things in the same object). REFUND_PENDING/REFUNDED are new: an order
// being refunded is a fact about the ORDER, not just its payment, so it needs its
// own status customers and admins can see and filter on.
//
// Delivery-partner-specific statuses (ASSIGNED, PICKED_UP, ARRIVED) are deliberately
// not added yet — they have no meaning without the assignment system, which arrives
// in a later milestone.
const ORDER_STATUS = Object.freeze({
  PLACED: 'PLACED',
  CONFIRMED: 'CONFIRMED',
  PREPARING: 'PREPARING',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
});

// Explicit allow-list of forward transitions, enforced in the order service, not just
// the UI. REFUND_PENDING/REFUNDED are reached only through the refund service (see
// refund.service.js), triggered automatically by a cancellation/rejection of a paid
// online order, or by an admin's manual refund — never through the generic
// PATCH /orders/:id/status endpoint restaurants and admins use day to day.
const ORDER_STATUS_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.PLACED]: [ORDER_STATUS.CONFIRMED, ORDER_STATUS.REJECTED, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.CONFIRMED]: [ORDER_STATUS.PREPARING, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.PREPARING]: [ORDER_STATUS.READY_FOR_PICKUP, ORDER_STATUS.CANCELLED],
  [ORDER_STATUS.READY_FOR_PICKUP]: [ORDER_STATUS.OUT_FOR_DELIVERY],
  [ORDER_STATUS.OUT_FOR_DELIVERY]: [ORDER_STATUS.DELIVERED],
  [ORDER_STATUS.DELIVERED]: [],
  [ORDER_STATUS.CANCELLED]: [],
  [ORDER_STATUS.REJECTED]: [],
  [ORDER_STATUS.REFUND_PENDING]: [ORDER_STATUS.REFUNDED],
  [ORDER_STATUS.REFUNDED]: [],
});

// Separate from ORDER_STATUS_TRANSITIONS: which order statuses a refund may be
// initiated from (refund.service.js), independent of the day-to-day status flow above.
const REFUNDABLE_FROM_STATUSES = Object.freeze([ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED, ORDER_STATUS.DELIVERED]);

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

// Who pays for a coupon's discount — recorded for later settlement reporting
// (Phase 38); does not change the discount calculation itself.
const COUPON_FUNDED_BY = Object.freeze({
  PLATFORM: 'PLATFORM',
  RESTAURANT: 'RESTAURANT',
  SHARED: 'SHARED',
});

const REFUND_STATUS = Object.freeze({
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
});

const PAYMENT_ATTEMPT_STATUS = Object.freeze({
  CREATED: 'CREATED', // a Razorpay order exists; the customer has not paid yet
  PAID: 'PAID',
  FAILED: 'FAILED',
});

// M6 — Delivery Partner Foundation. Two separate, deliberately-coupled state
// machines (see deliveryPartner.service.js for the exact transitions):
// KYC is "did their documents check out"; account status is "may they actually
// work right now" (a verified partner can still be suspended later for
// unrelated reasons, which must not silently re-open their KYC review).
const DELIVERY_KYC_STATUS = Object.freeze({
  PENDING: 'PENDING', // profile exists but documents not yet submitted (not reachable via the current create flow, reserved for a future "save as draft")
  SUBMITTED: 'SUBMITTED', // documents submitted, awaiting admin review
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
});

const DELIVERY_ACCOUNT_STATUS = Object.freeze({
  PENDING: 'PENDING', // awaiting KYC review
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  REJECTED: 'REJECTED',
});

// Server-authoritative — never trust a client-supplied availability value beyond
// this enum, and never let a partner go ONLINE without re-checking the two
// statuses above at the moment of the request (see deliveryPartner.service.js).
const DELIVERY_AVAILABILITY = Object.freeze({
  OFFLINE: 'OFFLINE',
  ONLINE: 'ONLINE',
});

const DELIVERY_VEHICLE_TYPES = Object.freeze(['BICYCLE', 'SCOOTER', 'MOTORCYCLE', 'CAR']);

// M7 — Delivery Assignment & Dispatch. A single order can accumulate several
// DeliveryAssignment rows over time (one per rider it was offered to); at most one
// of them may ever be "active" (OFFERED/ACCEPTED/ASSIGNED) at once — enforced by a
// partial unique index on `order` in the model, not just here.
//
// OFFERED   -> sent to one rider, awaiting their response, has an expiresAt.
// ACCEPTED  -> the rider said yes (acceptedAt recorded). Immediately followed, in
//              the same request, by an atomic attempt to claim the order itself.
// ASSIGNED  -> that claim succeeded (assignedAt recorded) — this is now THE
//              confirmed rider for the order. Kept distinct from ACCEPTED because
//              the claim is a separate atomic step that can, in principle, lose a
//              race (see deliveryAssignment.service.js) — an assignment that loses
//              that race is CANCELLED instead, never left stuck at ACCEPTED.
// REJECTED  -> the rider declined (rejectedAt + optional rejectionReason).
// EXPIRED   -> nobody responded before expiresAt. Detected lazily (via the
//              expiresAt check baked into every relevant query), never by a
//              background timer — see deliveryAssignment.service.js.
// CANCELLED -> the offer/assignment was called off before completion (order
//              cancelled/rejected, an admin cancelled it, or it lost the claim race).
// COMPLETED -> the order it belongs to reached DELIVERED.
const DELIVERY_ASSIGNMENT_STATUS = Object.freeze({
  OFFERED: 'OFFERED',
  ACCEPTED: 'ACCEPTED',
  ASSIGNED: 'ASSIGNED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
});

// "Active" = still occupying the one-active-assignment-per-order slot, and (for
// ACCEPTED/ASSIGNED) still occupying the rider's one-active-delivery slot.
const ACTIVE_ASSIGNMENT_STATUSES = Object.freeze([
  DELIVERY_ASSIGNMENT_STATUS.OFFERED,
  DELIVERY_ASSIGNMENT_STATUS.ACCEPTED,
  DELIVERY_ASSIGNMENT_STATUS.ASSIGNED,
]);

// M10 — Delivery Earnings & Settlement Foundation. Deliberately just two values:
// whether an earning has actually been PAID OUT yet, from the rider's point of
// view — not whether it has merely been grouped into a settlement that itself
// isn't paid yet (that in-between state still reads as PENDING here; see
// deliverySettlement.service.js's markPaid, the only place SETTLED is reached).
const DELIVERY_EARNING_STATUS = Object.freeze({
  PENDING: 'PENDING',
  SETTLED: 'SETTLED',
});

// A settlement groups one rider's unpaid earnings for a period into a single
// internal payout record. PROCESSING is defined now but not reachable by any
// action in this milestone (nothing here talks to a real payout gateway that
// could report "in flight") — the same "define now, wire up later" approach M6
// used for DELIVERY_KYC_STATUS.PENDING. PAID is terminal: there is no reversal
// architecture, so nothing transitions out of it (matches instructions).
const DELIVERY_SETTLEMENT_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const DELIVERY_SETTLEMENT_TRANSITIONS = Object.freeze({
  [DELIVERY_SETTLEMENT_STATUS.PENDING]: [DELIVERY_SETTLEMENT_STATUS.APPROVED, DELIVERY_SETTLEMENT_STATUS.CANCELLED],
  [DELIVERY_SETTLEMENT_STATUS.APPROVED]: [DELIVERY_SETTLEMENT_STATUS.PAID, DELIVERY_SETTLEMENT_STATUS.FAILED, DELIVERY_SETTLEMENT_STATUS.CANCELLED],
  [DELIVERY_SETTLEMENT_STATUS.PROCESSING]: [DELIVERY_SETTLEMENT_STATUS.PAID, DELIVERY_SETTLEMENT_STATUS.FAILED],
  [DELIVERY_SETTLEMENT_STATUS.FAILED]: [DELIVERY_SETTLEMENT_STATUS.APPROVED], // retry
  [DELIVERY_SETTLEMENT_STATUS.PAID]: [],
  [DELIVERY_SETTLEMENT_STATUS.CANCELLED]: [],
});

module.exports = {
  ROLES,
  ORDER_STATUS,
  ORDER_STATUS_TRANSITIONS,
  REFUNDABLE_FROM_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  DISCOUNT_TYPES,
  COUPON_FUNDED_BY,
  REFUND_STATUS,
  PAYMENT_ATTEMPT_STATUS,
  DELIVERY_KYC_STATUS,
  DELIVERY_ACCOUNT_STATUS,
  DELIVERY_AVAILABILITY,
  DELIVERY_VEHICLE_TYPES,
  DELIVERY_ASSIGNMENT_STATUS,
  ACTIVE_ASSIGNMENT_STATUSES,
  DELIVERY_EARNING_STATUS,
  DELIVERY_SETTLEMENT_STATUS,
  DELIVERY_SETTLEMENT_TRANSITIONS,
};
