const DeliveryEarning = require('../models/DeliveryEarning');
const ApiError = require('../utils/ApiError');
const { round2 } = require('./pricing.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const { DELIVERY_EARNING_STATUS } = require('../utils/constants');
const platformSettingService = require('./platformSetting.service');

// Reads an env var as a number, correctly honoring an explicit "0" override
// (unlike `Number(process.env.X) || fallback`, which would wrongly treat a
// deliberate zero as "unset"). Falls back on missing, empty, or non-numeric.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// M17 made these admin-configurable (PlatformSetting.delivery.*). They remain
// here as the DEFAULTS — the values the settings document seeds itself with on
// first read, and the values calculateEarning uses if it is ever called without
// rates (a unit test, or a caller predating M17). A deployment that set
// DELIVERY_BASE_EARNING therefore keeps its behaviour: the env var becomes the
// seed for the editable row instead of being read on every calculation.
const BASE_EARNING = envNumber('DELIVERY_BASE_EARNING', 20);
const PER_KM_RATE = envNumber('DELIVERY_PER_KM_RATE', 6);
const MIN_EARNING = envNumber('DELIVERY_MIN_EARNING', 20);
const MAX_EARNING = process.env.DELIVERY_MAX_EARNING ? envNumber('DELIVERY_MAX_EARNING', null) : null;

const DEFAULT_RATES = Object.freeze({
  baseEarning: BASE_EARNING,
  perKmRate: PER_KM_RATE,
  minEarning: MIN_EARNING,
  maxEarning: MAX_EARNING,
  incentives: {
    longDistance: { enabled: false, thresholdKm: 5, bonusAmount: 0 },
    peakHour: { enabled: false, windows: [], bonusAmount: 0 },
  },
});

// True when `date` falls inside a half-open [startHour, endHour) UTC window.
// Wrap-around windows (22 -> 2, meaning the late-night peak) are why this is not
// a plain `hour >= start && hour < end`: for those the two halves are unioned
// instead. UTC deliberately, matching the window definition on PlatformSetting.
function isWithinPeakWindow(date, windows) {
  const hour = date.getUTCHours();
  return windows.some(({ startHour, endHour }) => {
    if (startHour === endHour) return false; // empty window; the model rejects these
    if (startHour < endHour) return hour >= startHour && hour < endHour;
    return hour >= startHour || hour < endHour; // wraps past midnight
  });
}

// The incentive component of an earning, and the whole of what M10 left as a
// hardcoded 0. Both rules are flat bonuses that ADD (a long, late delivery earns
// both) rather than multiplying, so a rider can read their own payslip: each
// enabled rule contributes its own fixed amount or nothing at all.
function calculateIncentive({ distanceKm, earnedAt, incentives }) {
  if (!incentives) return 0;
  let bonus = 0;

  const long = incentives.longDistance;
  // Requires a real distance. An order whose distance is unknown pays no
  // distance component either — inventing a threshold comparison against a
  // missing number would quietly pay or withhold a bonus on no evidence.
  if (long && long.enabled && distanceKm !== null && distanceKm >= long.thresholdKm) {
    bonus += long.bonusAmount;
  }

  const peak = incentives.peakHour;
  if (peak && peak.enabled && peak.windows && peak.windows.length > 0 && isWithinPeakWindow(earnedAt, peak.windows)) {
    bonus += peak.bonusAmount;
  }

  return round2(bonus);
}

// Simple and configurable, deliberately not elaborate (no surge multiplier
// tables, no per-restaurant overrides — none of that is asked for and none of
// it is needed yet): base + distance (only when the order actually has a
// reliable deliveryDistanceKm — see order.service.js#createOrder /
// restaurantGeo.service.js, computed once from real coordinates at order
// placement, never invented here) + incentive (M17: the long-distance and
// peak-hour rules above, both off by default, so an untouched deployment still
// computes exactly what it did before). The result is then floored/optionally
// capped. Every step rounds through pricing.service.js's shared round2(), the
// same helper Order/Cart totals already use — money here follows the exact
// convention already established everywhere else in this codebase (plain Number,
// rounded to whole paise), not Decimal128.
//
// `rates` comes from platformSettingService.getDeliveryRates() — one read per
// earning, so every component of a single rider's payment is computed from one
// version of the config and cannot straddle an admin edit. Omitting it falls back
// to DEFAULT_RATES, which is what the pre-M17 behaviour was.
//
// `earnedAt` is when the delivery COMPLETED (the caller passes the same timestamp
// it stores on the record), because that is what the peak-hour rule is about: the
// hours the rider was actually out working, not when the customer ordered.
function calculateEarning(order, rates = DEFAULT_RATES, earnedAt = new Date()) {
  const { baseEarning, perKmRate, minEarning, maxEarning, incentives } = { ...DEFAULT_RATES, ...rates };

  const baseAmount = round2(baseEarning);
  const distanceKm = typeof order.deliveryDistanceKm === 'number' && order.deliveryDistanceKm >= 0 ? order.deliveryDistanceKm : null;
  const distanceAmount = distanceKm !== null ? round2(distanceKm * perKmRate) : 0;
  const incentiveAmount = calculateIncentive({ distanceKm, earnedAt, incentives });
  const grossAmount = round2(baseAmount + distanceAmount + incentiveAmount);
  const deductions = 0;

  let netAmount = round2(grossAmount - deductions);
  if (netAmount < minEarning) netAmount = round2(minEarning);
  if (maxEarning !== null && maxEarning !== undefined && netAmount > maxEarning) netAmount = round2(maxEarning);

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
  // earnedAt is resolved BEFORE the calculation and then reused for both, so the
  // peak-hour rule is evaluated against exactly the timestamp stored on the
  // record — a rider can never be shown an incentive that the stored time does
  // not justify. Settings are read once here, for the same reason.
  const earnedAt = assignment.completedAt || new Date();
  const rates = await platformSettingService.getDeliveryRates();
  const calc = calculateEarning(order, rates, earnedAt);
  try {
    return await DeliveryEarning.create({
      deliveryPartner: assignment.deliveryPartner,
      order: order._id,
      deliveryAssignment: assignment._id,
      orderNumber: order.orderNumber,
      earnedAt,
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
  DEFAULT_RATES,
  isWithinPeakWindow,
  calculateIncentive,
  calculateEarning,
  createEarningForCompletedDelivery,
  listForRider,
  getForRider,
  summaryForRider,
};
