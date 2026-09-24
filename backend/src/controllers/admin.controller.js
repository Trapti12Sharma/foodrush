const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const ApiError = require('../utils/ApiError');
const adminService = require('../services/admin.service');
const orderService = require('../services/order.service');
const auditService = require('../services/audit.service');
const refundService = require('../services/refund.service');
const deliveryPartnerService = require('../services/deliveryPartner.service');
const deliveryAssignmentService = require('../services/deliveryAssignment.service');
const deliverySettlementService = require('../services/deliverySettlement.service');
const Order = require('../models/Order');

const getDashboard = asyncHandler(async (req, res) => {
  const stats = await adminService.getDashboardStats();
  res.json(new ApiResponse(200, 'Platform dashboard fetched', stats));
});

const listUsers = asyncHandler(async (req, res) => {
  const { items, pagination } = await adminService.listUsers(req.query);
  res.json(new ApiResponse(200, 'Users fetched', { users: items, pagination }));
});

const setUserActive = asyncHandler(async (req, res) => {
  const user = await adminService.setUserActive(req.params.id, req.body.isActive, req.user);
  await auditService.record({
    req,
    action: 'user.set_active',
    entityType: 'User',
    entityId: user._id,
    metadata: { isActive: user.isActive, targetRole: user.role },
  });
  res.json(new ApiResponse(200, 'User updated', { user }));
});

const listRestaurants = asyncHandler(async (req, res) => {
  const { items, pagination } = await adminService.listRestaurantsForAdmin(req.query);
  res.json(new ApiResponse(200, 'Restaurants fetched', { restaurants: items, pagination }));
});

const approveRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await adminService.approveRestaurant(req.params.id);
  await auditService.record({
    req,
    action: 'restaurant.approve',
    entityType: 'Restaurant',
    entityId: restaurant._id,
    metadata: { name: restaurant.name },
  });
  res.json(new ApiResponse(200, 'Restaurant approved', { restaurant }));
});

const setRestaurantActive = asyncHandler(async (req, res) => {
  const restaurant = await adminService.setRestaurantActive(req.params.id, req.body.isActive);
  await auditService.record({
    req,
    action: 'restaurant.set_active',
    entityType: 'Restaurant',
    entityId: restaurant._id,
    metadata: { name: restaurant.name, isActive: restaurant.isActive },
  });
  res.json(new ApiResponse(200, 'Restaurant updated', { restaurant }));
});

// Staff with orders:read_all see every order; order.service.listOrdersForUser
// already returns an unscoped filter for them, so this just reuses it under /api/admin.
const listOrders = asyncHandler(async (req, res) => {
  const { items, pagination } = await orderService.listOrdersForUser(req.user, req.query);
  res.json(new ApiResponse(200, 'Orders fetched', { orders: items, pagination }));
});

const listAuditLogs = asyncHandler(async (req, res) => {
  const { items, pagination } = await auditService.listLogs(req.query);
  res.json(new ApiResponse(200, 'Audit logs fetched', { logs: items, pagination }));
});

const refundOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');

  const refund = await refundService.initiateRefund(order, {
    reason: req.body.reason || 'admin_initiated',
    actor: req.user,
    amount: req.body.amount,
  });
  await auditService.record({
    req,
    action: 'order.refund',
    entityType: 'Order',
    entityId: order._id,
    metadata: { orderNumber: order.orderNumber, amount: refund.amount, status: refund.status, refundId: refund._id },
  });
  res.json(new ApiResponse(200, 'Refund initiated', { refund }));
});

const listRefunds = asyncHandler(async (req, res) => {
  const { items, pagination } = await refundService.listRefunds(req.query);
  res.json(new ApiResponse(200, 'Refunds fetched', { refunds: items, pagination }));
});

const listDeliveryPartners = asyncHandler(async (req, res) => {
  const { items, pagination } = await deliveryPartnerService.listForAdmin(req.query);
  res.json(new ApiResponse(200, 'Delivery partners fetched', { deliveryPartners: items, pagination }));
});

const getDeliveryPartner = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.getByIdForAdmin(req.params.id);
  res.json(new ApiResponse(200, 'Delivery partner fetched', { deliveryPartner: partner }));
});

const approveDeliveryPartnerKyc = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.approveKyc(req.params.id, req.user);
  await auditService.record({
    req,
    action: 'delivery_partner.kyc_approve',
    entityType: 'DeliveryPartner',
    entityId: partner._id,
  });
  res.json(new ApiResponse(200, 'KYC approved — account activated', { deliveryPartner: partner }));
});

const rejectDeliveryPartnerKyc = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.rejectKyc(req.params.id, req.user, req.body.reason);
  await auditService.record({
    req,
    action: 'delivery_partner.kyc_reject',
    entityType: 'DeliveryPartner',
    entityId: partner._id,
    metadata: { reason: req.body.reason },
  });
  res.json(new ApiResponse(200, 'KYC rejected', { deliveryPartner: partner }));
});

const suspendDeliveryPartner = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.suspend(req.params.id, req.body.reason);
  await auditService.record({
    req,
    action: 'delivery_partner.suspend',
    entityType: 'DeliveryPartner',
    entityId: partner._id,
    metadata: { reason: req.body.reason || null },
  });
  res.json(new ApiResponse(200, 'Delivery partner suspended', { deliveryPartner: partner }));
});

const reactivateDeliveryPartner = asyncHandler(async (req, res) => {
  const partner = await deliveryPartnerService.reactivate(req.params.id);
  await auditService.record({
    req,
    action: 'delivery_partner.reactivate',
    entityType: 'DeliveryPartner',
    entityId: partner._id,
  });
  res.json(new ApiResponse(200, 'Delivery partner reactivated', { deliveryPartner: partner }));
});

const listDeliveryAssignments = asyncHandler(async (req, res) => {
  const { items, pagination } = await deliveryAssignmentService.listForAdmin(req.query);
  res.json(new ApiResponse(200, 'Delivery assignments fetched', { assignments: items, pagination }));
});

const listEligibleRiders = asyncHandler(async (req, res) => {
  const riders = await deliveryAssignmentService.listEligibleRidersForOrder(req.params.id);
  res.json(new ApiResponse(200, 'Eligible delivery partners fetched', { riders }));
});

const assignOrder = asyncHandler(async (req, res) => {
  const assignment = await deliveryAssignmentService.adminAssign(req.params.id, req.body.deliveryPartnerId, req.user);
  await auditService.record({
    req,
    action: 'order.assign_delivery_partner',
    entityType: 'Order',
    entityId: req.params.id,
    metadata: { deliveryPartner: assignment.deliveryPartner.toString(), manual: Boolean(req.body.deliveryPartnerId) },
  });
  res.status(201).json(new ApiResponse(201, 'Delivery offer created', { assignment }));
});

const cancelDeliveryAssignment = asyncHandler(async (req, res) => {
  const assignment = await deliveryAssignmentService.cancelAssignment(req.params.id, req.user, req.body.reason);
  await auditService.record({
    req,
    action: 'delivery_assignment.cancel',
    entityType: 'DeliveryAssignment',
    entityId: assignment._id,
    metadata: { reason: req.body.reason || null },
  });
  res.json(new ApiResponse(200, 'Delivery assignment cancelled', { assignment }));
});

const listDeliverySettlements = asyncHandler(async (req, res) => {
  const { items, pagination } = await deliverySettlementService.listForAdmin(req.query);
  res.json(new ApiResponse(200, 'Delivery settlements fetched', { settlements: items, pagination }));
});

const getDeliverySettlement = asyncHandler(async (req, res) => {
  const { settlement, earnings } = await deliverySettlementService.getByIdForAdmin(req.params.id);
  res.json(new ApiResponse(200, 'Delivery settlement fetched', { settlement, earnings }));
});

const generateDeliverySettlement = asyncHandler(async (req, res) => {
  const settlement = await deliverySettlementService.generate(
    { deliveryPartnerId: req.body.deliveryPartnerId, periodStart: req.body.periodStart, periodEnd: req.body.periodEnd },
    req.user
  );
  await auditService.record({
    req,
    action: 'delivery_settlement.generate',
    entityType: 'DeliverySettlement',
    entityId: settlement._id,
    metadata: { deliveryPartner: settlement.deliveryPartner.toString(), netAmount: settlement.netAmount, deliveryCount: settlement.deliveryCount },
  });
  res.status(201).json(new ApiResponse(201, 'Delivery settlement generated', { settlement }));
});

const approveDeliverySettlement = asyncHandler(async (req, res) => {
  const settlement = await deliverySettlementService.approve(req.params.id, req.user);
  await auditService.record({ req, action: 'delivery_settlement.approve', entityType: 'DeliverySettlement', entityId: settlement._id });
  res.json(new ApiResponse(200, 'Delivery settlement approved', { settlement }));
});

const markDeliverySettlementPaid = asyncHandler(async (req, res) => {
  const settlement = await deliverySettlementService.markPaid(req.params.id, req.user, {
    payoutReference: req.body.payoutReference,
    notes: req.body.notes,
  });
  await auditService.record({
    req,
    action: 'delivery_settlement.mark_paid',
    entityType: 'DeliverySettlement',
    entityId: settlement._id,
    metadata: { payoutReference: req.body.payoutReference || null, netAmount: settlement.netAmount },
  });
  res.json(new ApiResponse(200, 'Delivery settlement marked paid', { settlement }));
});

const markDeliverySettlementFailed = asyncHandler(async (req, res) => {
  const settlement = await deliverySettlementService.markFailed(req.params.id, req.user, req.body.reason);
  await auditService.record({
    req,
    action: 'delivery_settlement.mark_failed',
    entityType: 'DeliverySettlement',
    entityId: settlement._id,
    metadata: { reason: req.body.reason || null },
  });
  res.json(new ApiResponse(200, 'Delivery settlement marked failed', { settlement }));
});

module.exports = {
  getDashboard,
  listUsers,
  setUserActive,
  listRestaurants,
  approveRestaurant,
  setRestaurantActive,
  listOrders,
  listAuditLogs,
  refundOrder,
  listRefunds,
  listDeliveryPartners,
  getDeliveryPartner,
  approveDeliveryPartnerKyc,
  rejectDeliveryPartnerKyc,
  suspendDeliveryPartner,
  reactivateDeliveryPartner,
  listDeliveryAssignments,
  listEligibleRiders,
  assignOrder,
  cancelDeliveryAssignment,
  listDeliverySettlements,
  getDeliverySettlement,
  generateDeliverySettlement,
  approveDeliverySettlement,
  markDeliverySettlementPaid,
  markDeliverySettlementFailed,
};
