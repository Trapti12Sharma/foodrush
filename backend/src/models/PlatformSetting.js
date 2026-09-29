const mongoose = require('mongoose');

// M17 — the single, admin-editable source of truth for the platform's money
// rules: the tax rate that builds every order total, and the rates/incentives
// that decide what a rider earns for a delivery. Before this milestone those
// numbers were a hardcoded constant (pricing.service.js's TAX_RATE) and four
// boot-time env vars (DELIVERY_BASE_EARNING and friends), so changing any of
// them meant a redeploy. They are now values a SUPER_ADMIN edits at runtime.
//
// SINGLETON: exactly one document ever exists, pinned by a unique `key`. One row
// (rather than one document per setting) is deliberate — the cross-field
// invariant below (minEarning <= maxEarning) can only be checked atomically if
// every value lives in the same document, and the whole config is then one read
// for the cache and one write for an edit.
//
// WHAT IS DELIBERATELY NOT HERE: a platform commission rate. Commission comes
// out of a RESTAURANT's payout, and restaurant payouts/settlements do not exist
// yet (M10 built rider settlements only). A commission percentage that nothing
// subtracts from anything would be a dial that silently does nothing, so it
// waits for the milestone that actually builds restaurant payouts. Every field
// below is read by real code — see platformSetting.service.js.
//
// PAST ORDERS ARE NEVER RE-PRICED: orders and rider earnings already snapshot
// their own amounts at creation (Order.tax/totalAmount, DeliveryEarning.*), so
// editing a rate here changes what happens NEXT and never rewrites history.

const SETTINGS_KEY = 'platform';

// Reads an env var as a number, honoring an explicit "0" (unlike
// `Number(x) || fallback`, which treats a deliberate zero as unset). Same helper
// deliveryEarning.service.js already uses, duplicated rather than imported to
// keep this model free of service dependencies.
function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// Defaults applied when the document is first created. The delivery rates fall
// back to the same env vars M10 used, so a deployment that set
// DELIVERY_BASE_EARNING keeps its current behaviour the first time this document
// is created instead of silently snapping to a different number. After creation
// the document is authoritative and those env vars are ignored.
const DEFAULTS = Object.freeze({
  taxRate: 0.05, // the flat 5% pricing.service.js has always applied
  baseEarning: envNumber('DELIVERY_BASE_EARNING', 20),
  perKmRate: envNumber('DELIVERY_PER_KM_RATE', 6),
  minEarning: envNumber('DELIVERY_MIN_EARNING', 20),
  maxEarning: process.env.DELIVERY_MAX_EARNING ? envNumber('DELIVERY_MAX_EARNING', null) : null,
});

// A peak-hour window in UTC hours, half-open: [startHour, endHour). UTC matches
// the convention M16's dateRange.js and the existing $dateToString aggregations
// already use, so an operator reading analytics and an operator setting a window
// mean the same hours.
//
// WRAP-AROUND IS SUPPORTED AND MEANINGFUL: startHour 22, endHour 2 means
// 22:00-23:59 plus 00:00-01:59 — the dinner-to-late-night peak a naive
// `start < end` validation would reject. startHour === endHour is rejected
// rather than read as "all day": an operator typing one hour twice is far more
// likely to have made a mistake than to have meant 24 hours.
const peakWindowSchema = new mongoose.Schema(
  {
    startHour: {
      type: Number,
      required: true,
      min: 0,
      max: 23,
      validate: { validator: Number.isInteger, message: 'startHour must be a whole hour (0-23)' },
    },
    endHour: {
      type: Number,
      required: true,
      min: 0,
      max: 23,
      validate: { validator: Number.isInteger, message: 'endHour must be a whole hour (0-23)' },
    },
  },
  { _id: false }
);

const platformSettingSchema = new mongoose.Schema(
  {
    key: { type: String, default: SETTINGS_KEY, unique: true, immutable: true },

    pricing: {
      // Read by pricing.service.js on every cart recalculation and order
      // placement. Capped at 0.5 — a >50% tax rate is far more likely a typo
      // (0.5 typed as 5) than a real jurisdiction, and that typo would
      // overcharge every customer on the platform at once.
      taxRate: { type: Number, default: DEFAULTS.taxRate, min: 0, max: 0.5 },
    },

    delivery: {
      // Read by deliveryEarning.service.js#calculateEarning. Currency is INR,
      // plain Numbers rounded to whole paise — the same money convention
      // Order/Cart/DeliveryEarning already use, not Decimal128.
      baseEarning: { type: Number, default: DEFAULTS.baseEarning, min: 0, max: 10000 },
      perKmRate: { type: Number, default: DEFAULTS.perKmRate, min: 0, max: 1000 },
      minEarning: { type: Number, default: DEFAULTS.minEarning, min: 0, max: 10000 },
      // null means "no cap", the shipped default. Null rather than 0 because 0
      // is itself a real (if cruel) cap and the two must stay distinguishable.
      maxEarning: { type: Number, default: DEFAULTS.maxEarning, min: 0, max: 100000 },

      // M10 left DeliveryEarning.incentiveAmount hardcoded to 0, with a comment
      // saying the field existed for a future milestone. This is that milestone:
      // both rules below are applied by calculateEarning and land in that field,
      // so a rider's incentive line is explainable from these numbers alone.
      incentives: {
        // A flat bonus when a delivery is at least thresholdKm. Applies only
        // when the order has a real, server-computed deliveryDistanceKm (see
        // order.service.js) — never to an order whose distance is unknown,
        // which is the same rule the distance component itself follows.
        longDistance: {
          enabled: { type: Boolean, default: false },
          thresholdKm: { type: Number, default: 5, min: 0, max: 500 },
          bonusAmount: { type: Number, default: 0, min: 0, max: 10000 },
        },
        // A flat bonus when the delivery COMPLETED inside one of the windows.
        // Completion time (not order-placed time) is what the rider was
        // actually working through, and it is the timestamp DeliveryEarning
        // already records as earnedAt.
        peakHour: {
          enabled: { type: Boolean, default: false },
          windows: { type: [peakWindowSchema], default: [] },
          bonusAmount: { type: Number, default: 0, min: 0, max: 10000 },
        },
      },
    },

    // Optimistic concurrency: a PATCH carries the version it read, and the write
    // lands only if the stored version still matches (see
    // platformSetting.service.js#updateSettings). Two super-admins on the same
    // screen therefore cannot silently overwrite each other — the second gets a
    // 409 and re-reads. Mongoose's own __v is not used for this: it guards array
    // positional operators, not a $set of scalars.
    version: { type: Number, default: 1, min: 1 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true }
);

// Cross-field invariants, enforced on the MODEL rather than only in the
// validator layer so they hold for every write path — the admin API, a
// migration, a seed script, a future internal caller — exactly as earlier
// milestones enforce their status machines in services rather than in routes.
platformSettingSchema.pre('validate', function enforceInvariants(next) {
  const d = this.delivery;
  if (d && d.maxEarning !== null && d.maxEarning !== undefined && d.minEarning > d.maxEarning) {
    return next(new Error('delivery.minEarning cannot be greater than delivery.maxEarning'));
  }
  const peak = d && d.incentives && d.incentives.peakHour;
  if (peak && peak.enabled && (!peak.windows || peak.windows.length === 0)) {
    return next(new Error('delivery.incentives.peakHour.windows must contain at least one window while the peak-hour incentive is enabled'));
  }
  if (peak && peak.windows) {
    for (const w of peak.windows) {
      if (w.startHour === w.endHour) {
        return next(new Error(`delivery.incentives.peakHour window ${w.startHour}-${w.endHour} is empty — startHour and endHour must differ`));
      }
    }
  }
  return next();
});

const PlatformSetting = mongoose.model('PlatformSetting', platformSettingSchema);

PlatformSetting.SETTINGS_KEY = SETTINGS_KEY;
PlatformSetting.DEFAULTS = DEFAULTS;

module.exports = PlatformSetting;
