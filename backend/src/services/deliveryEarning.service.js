const DeliveryEarning = require('../models/DeliveryEarning');
const ApiError = require('../utils/ApiError');
const { round2 } = require('./pricing.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { DELIVERY_EARNING_STATUS } = require('../utils/constants');

// Reads an env var as a number, correctly honoring an explicit "0" override
// (unlike `Number(process.env.X) || fallback`, which would wrongly treat a
// deliberate zero as "unset"). Falls back on missing, empty, or non-numeric.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

const BASE_EARNING = envNumber('DELIVERY_BASE_EARNING', 20);
const PER_KM_RATE = envNumber('DELIVERY_PER_KM_RATE', 6);
const MIN_EARNING = envNumber('DELIVERY_MIN_EARNING', 20);
const MAX_EARNING = process.env.DELIVERY_MAX_EARNING ? envNumber('DELIVERY_MAX_EARNING', null) : null;

// Simple and configurable, deliberately not elaborate (no surge multiplier
// tables, no per-restaurant overrides — none of that is asked for and none of
// it is needed yet): base + distance (only when the order actually has a
// reliable deliveryDistanceKm — see order.service.js#createOrder /
// restaurantGeo.service.js, computed once from real coordinates at order
// placement, never invented here) + incentive (always 0 — no incentive rule
// exists in this milestone; the field exists for a future one). The result is
// then floored/optionally capped. Every step rounds through pricing.service.js's
// shared round2(), the same helper Order/Cart totals already use — money here
// follows the exact convention already established everywhere else in this
// codebase (plain Number, rounded to whole paise), not Decimal128.
function calculateEarning(order) {
  const baseAmount = round2(BASE_EARNING);
  const distanceKm = typeof order.deliveryDistanceKm === 'number' && order.deliveryDistanceKm >= 0 ? order.deliveryDistanceKm : null;
  const distanceAmount = distanceKm !== null ? round2(distanceKm * PER_KM_RATE) : 0;
  const incentiveAmount = 0;
  const grossAmount = round2(baseAmount + distanceAmount + incentiveAmount);
  const deductions = 0;

  let netAmount = round2(grossAmount - deductions);
  if (netAmount < MIN_EARNING) netAmount = round2(MIN_EARNING);
  if (MAX_EARNING !== null && netAmount > MAX_EARNING) netAmount = round2(MAX_EARNING);

  return { baseAmount, distanceKm, distanceAmount, incentiveAmount, grossAmount, deductions, netAmount };
}

// Called from deliveryAssignment.service.js#onOrderStatusChanged the instant an
// assignment reaches COMPLETED — the single, shared hook both the M9 OTP-verify
// path and the restaurant/admin manual-completion fallback funnel through, so
// a rider earns identically either way. `order` carries the real, server-
// computed totals/distance; nothing here is ever taken from a request body.
// Idempotent: the unique index on DeliveryEarning.order is the actual
// guarantee — a duplicate-key error here just means an earning already exists
// (e.g. onOrderStatusChanged somehow ran twice) and is treated as a no-op
// success, never a crash.
async function createEarningForCompletedDelivery(order, assignment) {
  const calc = calculateEarning(order);
  try {
    return await DeliveryEarning.create({
      deliveryPartner: assignment.deliveryPartner,
      order: order._id,
      deliveryAssignment: assignment._id,
      orderNumber: order.orderNumber,
      earnedAt: assignment.completedAt || new Date(),
      ...calc,
    });
  } catch (err) {
    if (err.code === 11000) return DeliveryEarning.findOne({ order: order._id });
    throw err;
  }
}

// All-time totals for the rider's wallet-style summary, independent of
// whatever page/date-range/status filter the earnings LIST itself is using —
// this is "how much have I ever earned / how much is still owed to me", not
// "totals for the current filtered page".
async function summaryForRider(rider) {
  const rows = await DeliveryEarning.aggregate([
    { $match: { deliveryPartner: rider._id } },
    { $group: { _id: '$status', total: { $sum: '$netAmount' } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((r) => [r._id, r.total]));
  const pendingSettlement = round2(byStatus[DELIVERY_EARNING_STATUS.PENDING] || 0);
  const settledAmount = round2(byStatus[DELIVERY_EARNING_STATUS.SETTLED] || 0);
  return { totalEarned: round2(pendingSettlement + settledAmount), pendingSettlement, settledAmount };
}

async function listForRider(rider, query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = { deliveryPartner: rider._id };
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.earnedAt = {};
    if (query.from) filter.earnedAt.$gte = new Date(query.from);
    if (query.to) filter.earnedAt.$lte = new Date(query.to);
  }

  const [items, total, summary] = await Promise.all([
    DeliveryEarning.find(filter).sort('-earnedAt').skip(skip).limit(limit),
    DeliveryEarning.countDocuments(filter),
    summaryForRider(rider),
  ]);

  return { items, pagination: buildPaginationMeta(total, page, limit), summary };
}

// Authenticated rider only, and only their OWN earning — an id that exists but
// belongs to someone else gets an identical 404, never a 403 (never confirms
// the id is real for someone it doesn't belong to).
async function getForRider(rider, earningId) {
  const earning = await DeliveryEarning.findById(earningId);
  if (!earning || earning.deliveryPartner.toString() !== rider._id.toString()) throw ApiError.notFound('Earning not found');
  return earning;
}

module.exports = {
  BASE_EARNING,
  PER_KM_RATE,
  MIN_EARNING,
  MAX_EARNING,
  calculateEarning,
  createEarningForCompletedDelivery,
  listForRider,
  getForRider,
  summaryForRider,
};
