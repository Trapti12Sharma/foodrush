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

// M14 — Restaurant Onboarding & KYC. Deliberately kept SEPARATE from
// `isApproved`/`isActive` (restaurant.service.js / admin.service.js), which stay
// the sole, sticky "may this restaurant take orders right now" switches — exactly
// as they already worked in every prior milestone. kycStatus only tracks "has
// this restaurant's business paperwork been reviewed": an admin's approve action
// requires SUBMITTED first (see admin.service.js#approveRestaurant) and moves it
// to VERIFIED in the same step, but nothing here ever flips isApproved/isActive
// back off on its own — an admin's existing setRestaurantActive is still the only
// way to take a live restaurant offline, so a routine KYC document renewal can
// never silently interrupt an operating restaurant.
const RESTAURANT_KYC_STATUS = Object.freeze({
  NOT_SUBMITTED: 'NOT_SUBMITTED', // default for every new restaurant — no documents on file yet
  SUBMITTED: 'SUBMITTED', // documents submitted, awaiting admin review
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
});

const RESTAURANT_KYC_TRANSITIONS = Object.freeze({
  [RESTAURANT_KYC_STATUS.NOT_SUBMITTED]: [RESTAURANT_KYC_STATUS.SUBMITTED],
  [RESTAURANT_KYC_STATUS.SUBMITTED]: [RESTAURANT_KYC_STATUS.VERIFIED, RESTAURANT_KYC_STATUS.REJECTED],
  [RESTAURANT_KYC_STATUS.REJECTED]: [RESTAURANT_KYC_STATUS.SUBMITTED], // fix documents and resubmit
  [RESTAURANT_KYC_STATUS.VERIFIED]: [RESTAURANT_KYC_STATUS.SUBMITTED], // e.g. renewing an expired FSSAI licence
});

// M15 — Review Moderation & Trust System. Every new review starts PENDING —
// never auto-approved — and only an APPROVED review counts toward a
// restaurant's public rating (see review.service.js#recalculateRestaurantRating).
// No generic transition table here on purpose (matching the DELIVERY_ASSIGNMENT_STATUS
// precedent below): each admin action (approve/reject/hide/restore) checks its
// own single required source status directly in review.service.js, since two
// different actions (approve, restore) can both land on APPROVED and a shared
// table can't tell them apart. The graph is:
//   PENDING  -> APPROVED (approve) | REJECTED (reject, reason required)
//   APPROVED -> HIDDEN (hide)
//   HIDDEN   -> APPROVED (restore)
//   REJECTED -> (admin-terminal; the author editing the review's content is the
//                only way back to PENDING — see review.service.js#updateReview)
const REVIEW_MODERATION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  HIDDEN: 'HIDDEN',
});

const REVIEW_REPORT_REASON = Object.freeze({
  SPAM: 'SPAM',
  ABUSIVE: 'ABUSIVE',
  OFFENSIVE: 'OFFENSIVE',
  FAKE: 'FAKE',
  IRRELEVANT: 'IRRELEVANT',
  OTHER: 'OTHER',
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

// M11 — Support Tickets. Any signed-in customer, restaurant owner, delivery
// partner, or staff member with SUPPORT_TICKETS_MANAGE may create one; only
// staff holding that permission may triage/assign/resolve them (see
// utils/permissions.js and services/supportTicket.service.js).
const SUPPORT_TICKET_CATEGORY = Object.freeze({
  ORDER: 'ORDER',
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  DELIVERY: 'DELIVERY',
  RESTAURANT: 'RESTAURANT',
  ACCOUNT: 'ACCOUNT',
  TECHNICAL: 'TECHNICAL',
  OTHER: 'OTHER',
});

const SUPPORT_TICKET_PRIORITY = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
});

const SUPPORT_TICKET_STATUS = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING_FOR_USER: 'WAITING_FOR_USER',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
});

// Explicit allow-list, enforced in supportTicket.service.js — never a raw
// `status = req.body.status` write. CLOSED is terminal (matches "closed tickets
// don't accept replies" — there is nothing left to do with one). Reopening a
// RESOLVED ticket is an intentional, explicit, admin-only action (RESOLVED ->
// IN_PROGRESS), not an accidental side effect of anything else.
const SUPPORT_TICKET_TRANSITIONS = Object.freeze({
  [SUPPORT_TICKET_STATUS.OPEN]: [SUPPORT_TICKET_STATUS.IN_PROGRESS, SUPPORT_TICKET_STATUS.CLOSED],
  [SUPPORT_TICKET_STATUS.IN_PROGRESS]: [SUPPORT_TICKET_STATUS.WAITING_FOR_USER, SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.CLOSED],
  [SUPPORT_TICKET_STATUS.WAITING_FOR_USER]: [SUPPORT_TICKET_STATUS.IN_PROGRESS, SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.CLOSED],
  [SUPPORT_TICKET_STATUS.RESOLVED]: [SUPPORT_TICKET_STATUS.CLOSED, SUPPORT_TICKET_STATUS.IN_PROGRESS], // the "reopen" path
  [SUPPORT_TICKET_STATUS.CLOSED]: [],
});

// Statuses a normal (non-staff) user may still post a message into — a RESOLVED
// or CLOSED ticket must be reopened (staff-only) before the creator can reply
// again, so a "resolved" ticket can't be silently kept alive forever by replies.
const SUPPORT_TICKET_OPEN_FOR_USER_REPLY = Object.freeze([
  SUPPORT_TICKET_STATUS.OPEN,
  SUPPORT_TICKET_STATUS.IN_PROGRESS,
  SUPPORT_TICKET_STATUS.WAITING_FOR_USER,
]);

// M12 — Notifications & Communication. One flat enum shared by in-app,
// Socket.IO, and email — a single type always means the same event everywhere.
const NOTIFICATION_TYPE = Object.freeze({
  ORDER_PLACED: 'ORDER_PLACED',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_REJECTED: 'ORDER_REJECTED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_READY: 'ORDER_READY',
  ORDER_OUT_FOR_DELIVERY: 'ORDER_OUT_FOR_DELIVERY',
  ORDER_DELIVERED: 'ORDER_DELIVERED',

  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_RETRY_REQUIRED: 'PAYMENT_RETRY_REQUIRED',
  REFUND_CREATED: 'REFUND_CREATED',
  REFUND_FAILED: 'REFUND_FAILED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',

  DELIVERY_ASSIGNED: 'DELIVERY_ASSIGNED',
  DELIVERY_ACCEPTED: 'DELIVERY_ACCEPTED',
  DELIVERY_REJECTED: 'DELIVERY_REJECTED',
  DELIVERY_STARTED: 'DELIVERY_STARTED',
  DELIVERY_COMPLETED: 'DELIVERY_COMPLETED',
  DELIVERY_OTP_REQUIRED: 'DELIVERY_OTP_REQUIRED',

  SUPPORT_TICKET_CREATED: 'SUPPORT_TICKET_CREATED',
  SUPPORT_TICKET_ASSIGNED: 'SUPPORT_TICKET_ASSIGNED',
  SUPPORT_TICKET_REPLIED: 'SUPPORT_TICKET_REPLIED',
  SUPPORT_TICKET_RESOLVED: 'SUPPORT_TICKET_RESOLVED',
  SUPPORT_TICKET_CLOSED: 'SUPPORT_TICKET_CLOSED',

  SETTLEMENT_GENERATED: 'SETTLEMENT_GENERATED',
  SETTLEMENT_APPROVED: 'SETTLEMENT_APPROVED',
  SETTLEMENT_PAID: 'SETTLEMENT_PAID',
  SETTLEMENT_FAILED: 'SETTLEMENT_FAILED',

  // M14 — Restaurant Onboarding & KYC.
  RESTAURANT_KYC_SUBMITTED: 'RESTAURANT_KYC_SUBMITTED',
  RESTAURANT_KYC_VERIFIED: 'RESTAURANT_KYC_VERIFIED',
  RESTAURANT_KYC_REJECTED: 'RESTAURANT_KYC_REJECTED',

  // M15 — Review Moderation & Trust System. Submission itself is deliberately
  // silent (no staff notification) — reviews are far higher-volume than KYC
  // submissions, and moderators work off the PENDING filter in the admin review
  // queue instead, the same way new orders never push-notify staff either.
  REVIEW_APPROVED: 'REVIEW_APPROVED',
  REVIEW_REJECTED: 'REVIEW_REJECTED',
  REVIEW_HIDDEN: 'REVIEW_HIDDEN',
  REVIEW_RESTORED: 'REVIEW_RESTORED',

  // M21 — the restaurant answered this customer's review. Mandatory and in-app
  // only, like the four above: no email template and no preference field, since
  // none of the existing buckets (order/payment/delivery/support) describes it.
  REVIEW_REPLIED: 'REVIEW_REPLIED',

  // Reserved for a future milestone — defined now so the enum is complete, not
  // wired to any trigger yet (matches the "define now, wire up later" precedent
  // already used for DELIVERY_KYC_STATUS.PENDING and DELIVERY_SETTLEMENT_STATUS.PROCESSING).
  ACCOUNT_SECURITY: 'ACCOUNT_SECURITY',
  SYSTEM: 'SYSTEM',
});

// Whether an email SEND was ever actually attempted/succeeded for a notification.
// SKIPPED covers every reason there was nothing to send (channel not requested,
// EMAIL_PROVIDER unset, or the recipient's own preference turned it off) — the
// in-app row is unaffected either way (see notification.service.js).
const NOTIFICATION_EMAIL_STATUS = Object.freeze({
  SKIPPED: 'SKIPPED',
  PENDING: 'PENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
});

// Which user-controllable NotificationPreference field gates the EMAIL channel
// for each type — the in-app row is ALWAYS created regardless (see
// notification.service.js's design note). A type with no entry here
// (ACCOUNT_SECURITY, SYSTEM) is mandatory and never gated by a preference.
const NOTIFICATION_PREFERENCE_FIELD = Object.freeze({
  ORDER_PLACED: 'orderUpdates',
  ORDER_CONFIRMED: 'orderUpdates',
  ORDER_REJECTED: 'orderUpdates',
  ORDER_CANCELLED: 'orderUpdates',
  ORDER_READY: 'orderUpdates',
  ORDER_OUT_FOR_DELIVERY: 'orderUpdates',
  ORDER_DELIVERED: 'orderUpdates',

  PAYMENT_SUCCESS: 'paymentUpdates',
  PAYMENT_FAILED: 'paymentUpdates',
  PAYMENT_RETRY_REQUIRED: 'paymentUpdates',
  REFUND_CREATED: 'paymentUpdates',
  REFUND_FAILED: 'paymentUpdates',
  REFUND_COMPLETED: 'paymentUpdates',

  DELIVERY_ASSIGNED: 'deliveryUpdates',
  DELIVERY_ACCEPTED: 'deliveryUpdates',
  DELIVERY_REJECTED: 'deliveryUpdates',
  DELIVERY_STARTED: 'deliveryUpdates',
  DELIVERY_COMPLETED: 'deliveryUpdates',
  DELIVERY_OTP_REQUIRED: 'deliveryUpdates',

  SUPPORT_TICKET_CREATED: 'supportUpdates',
  SUPPORT_TICKET_ASSIGNED: 'supportUpdates',
  SUPPORT_TICKET_REPLIED: 'supportUpdates',
  SUPPORT_TICKET_RESOLVED: 'supportUpdates',
  SUPPORT_TICKET_CLOSED: 'supportUpdates',

  // A rider's settlement is part of their delivery-earnings experience —
  // there is no dedicated "payouts" preference field, and inventing one the
  // spec never asked for would be its own unrequested feature.
  SETTLEMENT_GENERATED: 'deliveryUpdates',
  SETTLEMENT_APPROVED: 'deliveryUpdates',
  SETTLEMENT_PAID: 'deliveryUpdates',
  SETTLEMENT_FAILED: 'deliveryUpdates',
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
  RESTAURANT_KYC_STATUS,
  RESTAURANT_KYC_TRANSITIONS,
  REVIEW_MODERATION_STATUS,
  REVIEW_REPORT_REASON,
  DELIVERY_ASSIGNMENT_STATUS,
  ACTIVE_ASSIGNMENT_STATUSES,
  DELIVERY_EARNING_STATUS,
  DELIVERY_SETTLEMENT_STATUS,
  DELIVERY_SETTLEMENT_TRANSITIONS,
  SUPPORT_TICKET_CATEGORY,
  SUPPORT_TICKET_PRIORITY,
  SUPPORT_TICKET_STATUS,
  SUPPORT_TICKET_TRANSITIONS,
  SUPPORT_TICKET_OPEN_FOR_USER_REPLY,
  NOTIFICATION_TYPE,
  NOTIFICATION_EMAIL_STATUS,
  NOTIFICATION_PREFERENCE_FIELD,
};
