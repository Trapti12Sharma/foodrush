const asyncHandler = require('../utils/asyncHandler');
const ApiResponse = require('../utils/ApiResponse');
const staffService = require('../services/staff.service');

// M17 — the super-admin console. `req.user` is always passed through as the actor
// so the service can apply its self-change guards and attribute the audit entry;
// no handler here ever trusts an actor id from the body.

const getRoleMatrix = asyncHandler(async (req, res) => {
  res.json(new ApiResponse(200, 'Role and permission matrix', staffService.getRoleMatrix()));
});

const listStaff = asyncHandler(async (req, res) => {
  const { items, pagination } = await staffService.listStaff(req.query);
  res.json(new ApiResponse(200, 'Staff accounts', { items, pagination }));
});

const createStaff = asyncHandler(async (req, res) => {
  const { name, email, phone, role } = req.body;
  const staff = await staffService.createStaff({ name, email, phone, role }, req.user, req);
  // 201 with no credential in the body — the invitee sets their own password
  // through the emailed link (see staff.service.js).
  res.status(201).json(new ApiResponse(201, 'Staff account created and invite sent', { staff }));
});

const updateStaffRole = asyncHandler(async (req, res) => {
  const staff = await staffService.updateStaffRole(req.params.id, req.body.role, req.user, req);
  res.json(new ApiResponse(200, 'Role updated', { staff }));
});

const revokeStaff = asyncHandler(async (req, res) => {
  const staff = await staffService.revokeStaff(req.params.id, req.user, req);
  res.json(new ApiResponse(200, 'Staff access revoked', { staff }));
});

const resendInvite = asyncHandler(async (req, res) => {
  const staff = await staffService.resendInvite(req.params.id, req.user, req);
  res.json(new ApiResponse(200, 'Invite sent', { staff }));
});

module.exports = { getRoleMatrix, listStaff, createStaff, updateStaffRole, revokeStaff, resendInvite };
