const mongoose = require('mongoose');
const DeliveryEarning = require('../models/DeliveryEarning');
const DeliverySettlement = require('../models/DeliverySettlement');
const DeliveryPartner = require('../models/DeliveryPartner');
const ApiError = require('../utils/ApiError');
const { round2 } = require('./pricing.service');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');
const {
  DELIVERY_EARNING_STATUS,
  DELIVERY_SETTLEMENT_STATUS,
  DELIVERY_SETTLEMENT_TRANSITIONS,
} = require('../utils/constants');

function assertTransition(settlement, nextStatus) {
  const allowed = DELIVERY_SETTLEMENT_TRANSITIONS[settlement.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw ApiError.badRequest(`Cannot move a settlement from "${settlement.status}" to "${nextStatus}"`);
  }
}

// Generates ONE settlement for a rider covering [periodStart, periodEnd], from
// every earning that is PENDING, not already claimed by another settlement,
// and was earned within the period.
//
// Concurrency safety ("two admins generating the same settlement must not
// create duplicates"): the earnings are claimed ATOMICALLY via updateMany's
// own filter (settlement: null) BEFORE the settlement document is created —
// there is no window where an earning is "chosen" but not yet marked. If two
// admins race for the same rider/period, whichever updateMany reaches MongoDB
// first claims the earnings; the second's filter then matches nothing and it
// gets a clean "nothing to settle" error instead of an overlapping settlement.
async function generate({ deliveryPartnerId, periodStart, periodEnd }, actor) {
  const rider = await DeliveryPartner.findById(deliveryPartnerId);
  if (!rider) throw ApiError.notFound('Delivery partner not found');

  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    throw ApiError.badRequest('periodStart must be a valid date before periodEnd');
  }

  // Minted up front so the atomic claim below can stamp every matching earning
  // with it in the SAME operation that decides which earnings belong here.
  const settlementId = new mongoose.Types.ObjectId();
  const claim = await DeliveryEarning.updateMany(
    {
      deliveryPartner: rider._id,
      status: DELIVERY_EARNING_STATUS.PENDING,
      settlement: null,
      earnedAt: { $gte: start, $lte: end },
    },
    { $set: { settlement: settlementId } }
  );

  if (claim.modifiedCount === 0) {
    throw ApiError.badRequest('No unsettled earnings were found for this delivery partner in that period');
  }

  const earnings = await DeliveryEarning.find({ settlement: settlementId });
  const grossAmount = round2(earnings.reduce((sum, e) => sum + e.grossAmount, 0));
  const deductions = round2(earnings.reduce((sum, e) => sum + e.deductions, 0));
  const netAmount = round2(earnings.reduce((sum, e) => sum + e.netAmount, 0));

  try {
    return await DeliverySettlement.create({
      _id: settlementId,
      deliveryPartner: rider._id,
      periodStart: start,
      periodEnd: end,
      deliveryCount: earnings.length,
      grossAmount,
      deductions,
      netAmount,
      createdBy: actor._id,
    });
  } catch (err) {
    // Vanishingly unlikely (this id was just minted here) but if settlement
    // creation itself fails, release the claimed earnings rather than leaving
    // them silently pointing at a settlement that was never actually created.
    await DeliveryEarning.updateMany({ settlement: settlementId }, { $set: { settlement: null } });
    throw err;
  }
}

async function approve(id, actor) {
  const settlement = await DeliverySettlement.findById(id);
  if (!settlement) throw ApiError.notFound('Settlement not found');
  assertTransition(settlement, DELIVERY_SETTLEMENT_STATUS.APPROVED);

  settlement.status = DELIVERY_SETTLEMENT_STATUS.APPROVED;
  settlement.approvedAt = new Date();
  settlement.approvedBy = actor._id;
  await settlement.save();
  return settlement;
}

// Records that an admin has confirmed payment happened by some OTHER means
// (bank transfer, cash, UPI) — this never itself moves money and never talks
// to a real payout provider. See DEPLOYMENT.md / DeliverySettlement.js.
async function markPaid(id, actor, { payoutReference, notes } = {}) {
  const settlement = await DeliverySettlement.findById(id);
  if (!settlement) throw ApiError.notFound('Settlement not found');
  assertTransition(settlement, DELIVERY_SETTLEMENT_STATUS.PAID);

  settlement.status = DELIVERY_SETTLEMENT_STATUS.PAID;
  settlement.paidAt = new Date();
  settlement.paidBy = actor._id;
  if (payoutReference) settlement.payoutReference = payoutReference;
  if (notes) settlement.notes = notes;
  await settlement.save();

  // The only place a DeliveryEarning ever moves to SETTLED.
  await DeliveryEarning.updateMany(
    { settlement: settlement._id },
    { $set: { status: DELIVERY_EARNING_STATUS.SETTLED, settledAt: settlement.paidAt } }
  );

  return settlement;
}

async function markFailed(id, actor, reason) {
  const settlement = await DeliverySettlement.findById(id);
  if (!settlement) throw ApiError.notFound('Settlement not found');
  assertTransition(settlement, DELIVERY_SETTLEMENT_STATUS.FAILED);

  settlement.status = DELIVERY_SETTLEMENT_STATUS.FAILED;
  settlement.failedAt = new Date();
  settlement.failureReason = reason || null;
  await settlement.save();
  return settlement;
}

async function listForAdmin(query) {
  const { page, limit, skip } = parsePagination(query);
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.deliveryPartner) filter.deliveryPartner = query.deliveryPartner;

  const [items, total] = await Promise.all([
    DeliverySettlement.find(filter)
      .sort('-createdAt')
      .skip(skip)
      .limit(limit)
      .populate('deliveryPartner', 'fullName phone vehicleType vehicleNumber'),
    DeliverySettlement.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getByIdForAdmin(id) {
  const settlement = await DeliverySettlement.findById(id).populate('deliveryPartner', 'fullName phone vehicleType vehicleNumber');
  if (!settlement) throw ApiError.notFound('Settlement not found');
  const earnings = await DeliveryEarning.find({ settlement: settlement._id }).sort('-earnedAt');
  return { settlement, earnings };
}

module.exports = { generate, approve, markPaid, markFailed, listForAdmin, getByIdForAdmin };
