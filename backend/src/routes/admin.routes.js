const express = require('express');
const { body } = require('express-validator');
const adminController = require('../controllers/admin.controller');
const validate = require('../middleware/validate');
const { authenticateUser, requirePermission } = require('../middleware/auth.middleware');
const { supportLimiter } = require('../middleware/rateLimiter');
const { PERMISSIONS } = require('../utils/permissions');
const {
  updateStatusValidator: ticketStatusValidator,
  updatePriorityValidator: ticketPriorityValidator,
  assignTicketValidator,
  resolveTicketValidator,
  addMessageValidator: addTicketMessageValidator,
} = require('../validators/supportTicket.validator');

const REFUND_REASONS = ['customer_cancellation', 'restaurant_rejection', 'restaurant_unavailable', 'operational_issue', 'admin_initiated'];
const refundOrderValidator = [
  body('amount').optional().isFloat({ min: 0.01 }).withMessage('amount must be a positive number'),
  body('reason').optional().isIn(REFUND_REASONS).withMessage(`reason must be one of: ${REFUND_REASONS.join(', ')}`),
];

const rejectKycValidator = [body('reason').trim().notEmpty().withMessage('A rejection reason is required').isLength({ max: 500 })];
const suspendDeliveryPartnerValidator = [body('reason').optional({ checkFalsy: true }).trim().isLength({ max: 500 })];
const assignOrderValidator = [body('deliveryPartnerId').optional({ checkFalsy: true }).isMongoId().withMessage('deliveryPartnerId must be a valid id')];
const cancelAssignmentValidator = [body('reason').optional({ checkFalsy: true }).trim().isLength({ max: 500 })];

const generateSettlementValidator = [
  body('deliveryPartnerId').isMongoId().withMessage('A valid deliveryPartnerId is required'),
  body('periodStart').isISO8601().withMessage('periodStart must be a valid date'),
  body('periodEnd').isISO8601().withMessage('periodEnd must be a valid date'),
];
const markSettlementPaidValidator = [
  body('payoutReference').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('notes').optional({ checkFalsy: true }).trim().isLength({ max: 500 }),
];
const markSettlementFailedValidator = [body('reason').optional({ checkFalsy: true }).trim().isLength({ max: 500 })];

const router = express.Router();

router.use(authenticateUser);

/**
 * @swagger
 * /admin/dashboard:
 *   get:
 *     summary: Platform-wide stats (ADMIN only)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Platform stats, a 7-day order-count series, and a per-status breakdown
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalUsers: { type: integer }
 *                     totalRestaurants: { type: integer }
 *                     totalOrders: { type: integer }
 *                     pendingOrders: { type: integer }
 *                     deliveredOrders: { type: integer }
 *                     revenue: { type: number, description: 'Sum of totalAmount over DELIVERED orders only' }
 *                     statusBreakdown:
 *                       type: array
 *                       items: { type: object, properties: { status: { type: string }, count: { type: integer } } }
 *                     last7Days:
 *                       type: array
 *                       items: { type: object, properties: { date: { type: string, format: date }, count: { type: integer } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/dashboard', requirePermission(PERMISSIONS.DASHBOARD_VIEW), adminController.getDashboard);

/**
 * @swagger
 * /admin/users:
 *   get:
 *     summary: List/search users (ADMIN only)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Matches name or email
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [CUSTOMER, RESTAURANT_OWNER, ADMIN] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     users: { type: array, items: { $ref: '#/components/schemas/User' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/users', requirePermission(PERMISSIONS.USERS_READ), adminController.listUsers);

/**
 * @swagger
 * /admin/users/{id}/status:
 *   patch:
 *     summary: Enable/disable a user account (ADMIN only)
 *     description: A disabled account is rejected on login (403) and on its very next authenticated request even with a still-valid token (401) — isActive is re-checked from the DB on every request, not cached in the JWT.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [isActive], properties: { isActive: { type: boolean } } }
 *     responses:
 *       200:
 *         description: Updated user
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { user: { $ref: '#/components/schemas/User' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/users/:id/status',
  requirePermission(PERMISSIONS.USERS_MANAGE),
  [body('isActive').isBoolean()],
  validate,
  adminController.setUserActive
);

/**
 * @swagger
 * /admin/restaurants:
 *   get:
 *     summary: List/search every restaurant, including unapproved/inactive ones (ADMIN only)
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: isApproved
 *         schema: { type: boolean }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - in: query
 *         name: kycStatus
 *         schema: { type: string, enum: [NOT_SUBMITTED, SUBMITTED, VERIFIED, REJECTED] }
 *         description: M14 — filter by business-verification review state
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of restaurants, each with its owner's name/email populated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     restaurants: { type: array, items: { $ref: '#/components/schemas/Restaurant' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/restaurants', requirePermission(PERMISSIONS.RESTAURANTS_READ_ALL), adminController.listRestaurants);

/**
 * @swagger
 * /admin/restaurants/{id}/approve:
 *   patch:
 *     summary: Approve a restaurant's KYC, making it publicly visible (requires the restaurants:approve permission)
 *     description: >
 *       M14 — only valid once the restaurant's business-verification documents have actually been
 *       submitted (kycStatus=SUBMITTED via POST /restaurants/{id}/kyc/submit); rejected with 400
 *       otherwise. Sets kycStatus=VERIFIED and isApproved=true together, in one step.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Approved restaurant
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       400: { description: 'KYC has not been submitted (or was already reviewed) — cannot approve yet' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/restaurants/:id/approve', requirePermission(PERMISSIONS.RESTAURANTS_APPROVE), adminController.approveRestaurant);

/**
 * @swagger
 * /admin/restaurants/{id}/reject-kyc:
 *   patch:
 *     summary: Reject a restaurant's submitted KYC documents (requires the restaurants:approve permission)
 *     description: >
 *       Only valid from kycStatus=SUBMITTED. A reason is required and shown back to the owner, who
 *       may fix the documents and resubmit. Never touches isApproved/isActive — an already-live
 *       restaurant whose KYC renewal is rejected stays live.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: KYC rejected }
 *       400: { description: 'Not currently SUBMITTED' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/restaurants/:id/reject-kyc',
  requirePermission(PERMISSIONS.RESTAURANTS_APPROVE),
  rejectKycValidator,
  validate,
  adminController.rejectRestaurantKyc
);

/**
 * @swagger
 * /admin/restaurants/{id}/status:
 *   patch:
 *     summary: Enable/disable a restaurant (ADMIN only)
 *     description: A disabled restaurant disappears from public search/detail immediately, but its order/review history is untouched.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [isActive], properties: { isActive: { type: boolean } } }
 *     responses:
 *       200:
 *         description: Updated restaurant
 *         content:
 *           application/json:
 *             schema: { type: object, properties: { data: { type: object, properties: { restaurant: { $ref: '#/components/schemas/Restaurant' } } } } }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/restaurants/:id/status',
  requirePermission(PERMISSIONS.RESTAURANTS_MANAGE),
  [body('isActive').isBoolean()],
  validate,
  adminController.setRestaurantActive
);

/**
 * @swagger
 * /admin/orders:
 *   get:
 *     summary: List every order platform-wide (ADMIN only)
 *     description: Reuses the same unscoped branch GET /orders already takes for an ADMIN caller, under this dedicated admin-only path.
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [PLACED, CONFIRMED, PREPARING, READY_FOR_PICKUP, OUT_FOR_DELIVERY, DELIVERED, CANCELLED, REJECTED, REFUND_PENDING, REFUNDED] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 12 }
 *     responses:
 *       200:
 *         description: A page of orders
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     orders: { type: array, items: { $ref: '#/components/schemas/Order' } }
 *                     pagination: { $ref: '#/components/schemas/Pagination' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/orders', requirePermission(PERMISSIONS.ORDERS_READ_ALL), adminController.listOrders);

/**
 * @swagger
 * /admin/orders/{id}/refund:
 *   post:
 *     summary: Manually refund a paid online order (requires the refunds:manage permission)
 *     description: >
 *       Calls Razorpay's refund API for real. Only a paid ONLINE order in CANCELLED, REJECTED or DELIVERED
 *       status can be refunded. Idempotent — calling this again while a refund is already in flight or done
 *       returns that same refund rather than issuing a second one. A gateway failure is recorded as a FAILED
 *       Refund row (200 response) rather than a 5xx, so an admin can see and retry it.
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount: { type: number, description: 'Omit for a full refund of the order total' }
 *               reason: { type: string, enum: [customer_cancellation, restaurant_rejection, restaurant_unavailable, operational_issue, admin_initiated], default: admin_initiated }
 *     responses:
 *       200: { description: The Refund record (status PENDING/PROCESSING/COMPLETED/FAILED) }
 *       400: { description: Order is not a refundable paid online order }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/orders/:id/refund',
  requirePermission(PERMISSIONS.REFUNDS_MANAGE),
  refundOrderValidator,
  validate,
  adminController.refundOrder
);

/**
 * @swagger
 * /admin/refunds:
 *   get:
 *     summary: List refunds (requires the refunds:manage permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, PROCESSING, COMPLETED, FAILED] } }
 *       - { in: query, name: order, schema: { type: string } }
 *     responses:
 *       200: { description: A page of refunds }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/refunds', requirePermission(PERMISSIONS.REFUNDS_MANAGE), adminController.listRefunds);

/**
 * @swagger
 * /admin/audit-logs:
 *   get:
 *     summary: Browse the append-only audit trail (SUPER_ADMIN only)
 *     description: Requires the audit:read permission. Filter by action, actor, entityType/entityId and a createdAt range.
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: action, schema: { type: string }, description: 'e.g. restaurant.approve' }
 *       - { in: query, name: actor, schema: { type: string }, description: Actor user id }
 *       - { in: query, name: entityType, schema: { type: string } }
 *       - { in: query, name: entityId, schema: { type: string } }
 *       - { in: query, name: actorRole, schema: { type: string } }
 *       - { in: query, name: from, schema: { type: string, format: date-time } }
 *       - { in: query, name: to, schema: { type: string, format: date-time } }
 *     responses:
 *       200: { description: Audit log page }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/audit-logs', requirePermission(PERMISSIONS.AUDIT_READ), adminController.listAuditLogs);

/**
 * @swagger
 * /admin/audit-logs/{id}:
 *   get:
 *     summary: Get one audit log entry (requires the audit:read permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Audit log entry }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/audit-logs/:id', requirePermission(PERMISSIONS.AUDIT_READ), adminController.getAuditLog);

/**
 * @swagger
 * /admin/delivery-partners:
 *   get:
 *     summary: List delivery partners (requires the delivery_partners:manage permission)
 *     description: Documents, driving licence number, date of birth and emergency contact are omitted from this list view — only GET /admin/delivery-partners/{id} returns them.
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: search, schema: { type: string }, description: Matches fullName, phone or vehicleNumber }
 *       - { in: query, name: kycStatus, schema: { type: string, enum: [PENDING, SUBMITTED, VERIFIED, REJECTED] } }
 *       - { in: query, name: accountStatus, schema: { type: string, enum: [PENDING, ACTIVE, SUSPENDED, REJECTED] } }
 *       - { in: query, name: city, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200: { description: A page of delivery partners }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/delivery-partners', requirePermission(PERMISSIONS.DELIVERY_PARTNERS_MANAGE), adminController.listDeliveryPartners);

/**
 * @swagger
 * /admin/delivery-partners/{id}:
 *   get:
 *     summary: Full delivery partner detail, including KYC documents (requires the delivery_partners:manage permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Delivery partner detail }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/delivery-partners/:id', requirePermission(PERMISSIONS.DELIVERY_PARTNERS_MANAGE), adminController.getDeliveryPartner);

/**
 * @swagger
 * /admin/delivery-partners/{id}/approve-kyc:
 *   patch:
 *     summary: Approve KYC — also activates the account (requires the delivery_partners:manage permission)
 *     description: Only valid from kycStatus=SUBMITTED.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: KYC approved, account now ACTIVE }
 *       400: { description: 'Not currently SUBMITTED' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch(
  '/delivery-partners/:id/approve-kyc',
  requirePermission(PERMISSIONS.DELIVERY_PARTNERS_MANAGE),
  adminController.approveDeliveryPartnerKyc
);

/**
 * @swagger
 * /admin/delivery-partners/{id}/reject-kyc:
 *   patch:
 *     summary: Reject KYC — also rejects the account (requires the delivery_partners:manage permission)
 *     description: Only valid from kycStatus=SUBMITTED. A reason is required and shown back to the partner.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [reason], properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: KYC rejected }
 *       400: { description: 'Not currently SUBMITTED' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/delivery-partners/:id/reject-kyc',
  requirePermission(PERMISSIONS.DELIVERY_PARTNERS_MANAGE),
  rejectKycValidator,
  validate,
  adminController.rejectDeliveryPartnerKyc
);

/**
 * @swagger
 * /admin/delivery-partners/{id}/suspend:
 *   patch:
 *     summary: Suspend an active delivery partner (requires the delivery_partners:manage permission)
 *     description: Only valid from accountStatus=ACTIVE. Also forces the partner OFFLINE immediately.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: Suspended }
 *       400: { description: 'Not currently ACTIVE' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/delivery-partners/:id/suspend',
  requirePermission(PERMISSIONS.DELIVERY_PARTNERS_MANAGE),
  suspendDeliveryPartnerValidator,
  validate,
  adminController.suspendDeliveryPartner
);

/**
 * @swagger
 * /admin/delivery-partners/{id}/reactivate:
 *   patch:
 *     summary: Reactivate a suspended delivery partner (requires the delivery_partners:manage permission)
 *     description: Only valid from accountStatus=SUSPENDED, and only while KYC is still VERIFIED.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Reactivated }
 *       400: { description: 'Not currently SUSPENDED, or KYC no longer VERIFIED' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch(
  '/delivery-partners/:id/reactivate',
  requirePermission(PERMISSIONS.DELIVERY_PARTNERS_MANAGE),
  adminController.reactivateDeliveryPartner
);

/**
 * @swagger
 * /admin/delivery-assignments:
 *   get:
 *     summary: List/filter delivery assignments (requires the delivery_assignments:manage permission)
 *     description: One row per rider an order was offered to — an order can have several over its dispatch history. Filter by order to see one order's full attempt history.
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [OFFERED, ACCEPTED, ASSIGNED, REJECTED, EXPIRED, CANCELLED, COMPLETED] } }
 *       - { in: query, name: order, schema: { type: string } }
 *       - { in: query, name: deliveryPartner, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200: { description: A page of delivery assignments }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/delivery-assignments', requirePermission(PERMISSIONS.DELIVERY_ASSIGNMENTS_MANAGE), adminController.listDeliveryAssignments);

/**
 * @swagger
 * /admin/orders/{id}/eligible-riders:
 *   get:
 *     summary: Eligible nearby ONLINE delivery partners for an order (requires the delivery_assignments:manage permission)
 *     description: Same real-geography ACTIVE+VERIFIED+ONLINE+not-busy eligibility rule dispatch itself uses — never a random or insertion-order list.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Eligible riders, nearest first }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/orders/:id/eligible-riders', requirePermission(PERMISSIONS.DELIVERY_ASSIGNMENTS_MANAGE), adminController.listEligibleRiders);

/**
 * @swagger
 * /admin/orders/{id}/assign:
 *   post:
 *     summary: Assign a delivery partner to a READY_FOR_PICKUP order (requires the delivery_assignments:manage permission)
 *     description: >
 *       With deliveryPartnerId, offers that specific eligible rider. Without it, runs the same automatic
 *       nearest-eligible-candidate dispatch the system uses on its own — useful to retry after an offer expired.
 *       Creating a second active offer for an order that already has one fails with 409 (a DB-level guarantee,
 *       not just an application check).
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { deliveryPartnerId: { type: string } } }
 *     responses:
 *       201: { description: Delivery offer created }
 *       400: { description: 'Order not READY_FOR_PICKUP, already assigned, or the chosen rider is not eligible' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       409: { description: This order already has an active delivery assignment }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/orders/:id/assign',
  requirePermission(PERMISSIONS.DELIVERY_ASSIGNMENTS_MANAGE),
  assignOrderValidator,
  validate,
  adminController.assignOrder
);

/**
 * @swagger
 * /admin/delivery-assignments/{id}/cancel:
 *   patch:
 *     summary: Cancel an active delivery assignment (requires the delivery_assignments:manage permission)
 *     description: Only valid while OFFERED/ACCEPTED/ASSIGNED. If the assignment had already claimed the order, the order's deliveryPartner is cleared (its orderStatus is left untouched) so it can be redispatched.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: Cancelled }
 *       400: { description: Not currently active }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/delivery-assignments/:id/cancel',
  requirePermission(PERMISSIONS.DELIVERY_ASSIGNMENTS_MANAGE),
  cancelAssignmentValidator,
  validate,
  adminController.cancelDeliveryAssignment
);

/**
 * @swagger
 * /admin/delivery-settlements:
 *   get:
 *     summary: List/filter delivery settlements (requires the delivery_settlements:manage permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [PENDING, APPROVED, PROCESSING, PAID, FAILED, CANCELLED] } }
 *       - { in: query, name: deliveryPartner, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200: { description: A page of settlements }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/delivery-settlements', requirePermission(PERMISSIONS.DELIVERY_SETTLEMENTS_MANAGE), adminController.listDeliverySettlements);

/**
 * @swagger
 * /admin/delivery-settlements/{id}:
 *   get:
 *     summary: One settlement's detail, including every earning it includes (requires the delivery_settlements:manage permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Settlement detail + its earnings }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/delivery-settlements/:id', requirePermission(PERMISSIONS.DELIVERY_SETTLEMENTS_MANAGE), adminController.getDeliverySettlement);

/**
 * @swagger
 * /admin/delivery-settlements/generate:
 *   post:
 *     summary: Generate one settlement for a rider covering a period (requires the delivery_settlements:manage permission)
 *     description: >
 *       Includes every PENDING earning for this rider, earned within [periodStart, periodEnd], not already
 *       claimed by another settlement. Atomic against two admins racing to generate the same settlement — see
 *       deliverySettlement.service.js. Fails with 400 if there is nothing unsettled to include.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [deliveryPartnerId, periodStart, periodEnd]
 *             properties:
 *               deliveryPartnerId: { type: string }
 *               periodStart: { type: string, format: date }
 *               periodEnd: { type: string, format: date }
 *     responses:
 *       201: { description: Settlement generated }
 *       400: { description: 'Invalid period, or nothing unsettled to include' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.post(
  '/delivery-settlements/generate',
  requirePermission(PERMISSIONS.DELIVERY_SETTLEMENTS_MANAGE),
  generateSettlementValidator,
  validate,
  adminController.generateDeliverySettlement
);

/**
 * @swagger
 * /admin/delivery-settlements/{id}/approve:
 *   patch:
 *     summary: Approve a pending settlement (requires the delivery_settlements:manage permission)
 *     description: Only valid from PENDING.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Approved }
 *       400: { description: Not currently PENDING }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/delivery-settlements/:id/approve', requirePermission(PERMISSIONS.DELIVERY_SETTLEMENTS_MANAGE), adminController.approveDeliverySettlement);

/**
 * @swagger
 * /admin/delivery-settlements/{id}/mark-paid:
 *   patch:
 *     summary: Mark a settlement as paid (requires the delivery_settlements:manage permission)
 *     description: >
 *       Only valid from APPROVED. This records that the admin confirmed payment happened by some OTHER
 *       means (bank transfer, cash, UPI) — it does NOT itself transfer money or call any payout provider (none
 *       is integrated in this milestone). `payoutReference` is a free-text note the admin enters, never a
 *       gateway-confirmed value. Every earning included in this settlement moves to SETTLED.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               payoutReference: { type: string, description: 'Admin-entered note, e.g. a bank UTR — never gateway-confirmed' }
 *               notes: { type: string }
 *     responses:
 *       200: { description: Marked paid }
 *       400: { description: Not currently APPROVED }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/delivery-settlements/:id/mark-paid',
  requirePermission(PERMISSIONS.DELIVERY_SETTLEMENTS_MANAGE),
  markSettlementPaidValidator,
  validate,
  adminController.markDeliverySettlementPaid
);

/**
 * @swagger
 * /admin/delivery-settlements/{id}/failed:
 *   patch:
 *     summary: Mark a settlement as failed (requires the delivery_settlements:manage permission)
 *     description: Only valid from APPROVED or PROCESSING. Does not release the settlement's earnings — re-approve to retry.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { reason: { type: string } } }
 *     responses:
 *       200: { description: Marked failed }
 *       400: { description: 'Not currently APPROVED/PROCESSING' }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/delivery-settlements/:id/failed',
  requirePermission(PERMISSIONS.DELIVERY_SETTLEMENTS_MANAGE),
  markSettlementFailedValidator,
  validate,
  adminController.markDeliverySettlementFailed
);

/**
 * @swagger
 * /admin/support/tickets:
 *   get:
 *     summary: List/search/filter every support ticket (requires the support_tickets:manage permission)
 *     description: Never loads the whole collection — filtered, paginated MongoDB queries only.
 *     tags: [Admin]
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [OPEN, IN_PROGRESS, WAITING_FOR_USER, RESOLVED, CLOSED] } }
 *       - { in: query, name: priority, schema: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] } }
 *       - { in: query, name: category, schema: { type: string, enum: [ORDER, PAYMENT, REFUND, DELIVERY, RESTAURANT, ACCOUNT, TECHNICAL, OTHER] } }
 *       - { in: query, name: role, schema: { type: string }, description: Filters by createdByRole }
 *       - { in: query, name: assignedTo, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string }, description: Matches ticketNumber or subject }
 *       - { in: query, name: orderNumber, schema: { type: string } }
 *       - { in: query, name: page, schema: { type: integer, default: 1 } }
 *       - { in: query, name: limit, schema: { type: integer, default: 12 } }
 *     responses:
 *       200: { description: A page of tickets (list view omits messages/description) }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 */
router.get('/support/tickets', requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE), adminController.listSupportTickets);

/**
 * @swagger
 * /admin/support/tickets/{id}:
 *   get:
 *     summary: Full ticket detail, including the full conversation (requires the support_tickets:manage permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Ticket detail }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.get('/support/tickets/:id', requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE), adminController.getSupportTicket);

/**
 * @swagger
 * /admin/support/tickets/{id}/status:
 *   patch:
 *     summary: Move a ticket to a new status (requires the support_tickets:manage permission)
 *     description: Enforces an explicit allow-list of transitions — an arbitrary status is rejected with 400, never silently applied.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [status], properties: { status: { type: string, enum: [OPEN, IN_PROGRESS, WAITING_FOR_USER, RESOLVED, CLOSED] } } }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: That transition is not allowed from the ticket's current status }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/support/tickets/:id/status',
  requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE),
  ticketStatusValidator,
  validate,
  adminController.updateSupportTicketStatus
);

/**
 * @swagger
 * /admin/support/tickets/{id}/priority:
 *   patch:
 *     summary: Change a ticket's priority (requires the support_tickets:manage permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [priority], properties: { priority: { type: string, enum: [LOW, MEDIUM, HIGH, URGENT] } } }
 *     responses:
 *       200: { description: Updated }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/support/tickets/:id/priority',
  requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE),
  ticketPriorityValidator,
  validate,
  adminController.updateSupportTicketPriority
);

/**
 * @swagger
 * /admin/support/tickets/{id}/assign:
 *   patch:
 *     summary: Assign (or unassign) a ticket to a staff member (requires the support_tickets:manage permission)
 *     description: >
 *       The assignee must themselves hold the support_tickets:manage permission — a normal customer, restaurant
 *       owner or delivery partner id is rejected with 400, and can never be used to assign a ticket to themselves
 *       or to another admin.  Omit assignedTo to unassign.
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { assignedTo: { type: string, description: 'A staff user id, or omit to unassign' } } }
 *     responses:
 *       200: { description: Assigned }
 *       400: { description: assignedTo is not a support-capable staff member }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/support/tickets/:id/assign',
  requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE),
  assignTicketValidator,
  validate,
  adminController.assignSupportTicket
);

/**
 * @swagger
 * /admin/support/tickets/{id}/messages:
 *   post:
 *     summary: Reply to a ticket as staff (requires the support_tickets:manage permission)
 *     description: Rejected with 400 while the ticket is CLOSED — reopen it first (PATCH .../status to IN_PROGRESS).
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [message]
 *             properties:
 *               message: { type: string, maxLength: 2000 }
 *               attachments: { type: array, items: { type: string }, maxItems: 3 }
 *     responses:
 *       201: { description: Message added }
 *       400: { description: This ticket is closed }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 *       429: { description: Too many requests }
 */
router.post(
  '/support/tickets/:id/messages',
  supportLimiter,
  requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE),
  addTicketMessageValidator,
  validate,
  adminController.addSupportTicketMessage
);

/**
 * @swagger
 * /admin/support/tickets/{id}/resolve:
 *   patch:
 *     summary: Mark a ticket resolved, optionally recording a resolution note (requires the support_tickets:manage permission)
 *     description: Only valid from IN_PROGRESS or WAITING_FOR_USER (the same allow-list PATCH .../status enforces).
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema: { type: object, properties: { resolution: { type: string, maxLength: 2000 } } }
 *     responses:
 *       200: { description: Resolved }
 *       400: { description: That transition is not allowed from the ticket's current status }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 *       422: { $ref: '#/components/responses/ValidationError' }
 */
router.patch(
  '/support/tickets/:id/resolve',
  requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE),
  resolveTicketValidator,
  validate,
  adminController.resolveSupportTicket
);

/**
 * @swagger
 * /admin/support/tickets/{id}/close:
 *   patch:
 *     summary: Close a ticket (requires the support_tickets:manage permission)
 *     tags: [Admin]
 *     parameters:
 *       - { in: path, name: id, required: true, schema: { type: string } }
 *     responses:
 *       200: { description: Closed }
 *       400: { description: That transition is not allowed from the ticket's current status }
 *       401: { $ref: '#/components/responses/Unauthorized' }
 *       403: { $ref: '#/components/responses/Forbidden' }
 *       404: { $ref: '#/components/responses/NotFound' }
 */
router.patch('/support/tickets/:id/close', requirePermission(PERMISSIONS.SUPPORT_TICKETS_MANAGE), adminController.closeSupportTicketAdmin);

module.exports = router;
