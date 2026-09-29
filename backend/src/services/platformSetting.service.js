const PlatformSetting = require('../models/PlatformSetting');
const ApiError = require('../utils/ApiError');
const auditService = require('./audit.service');

// M17 — reads and writes the singleton platform settings document, and owns the
// cache that lets hot paths (cart recalculation, order placement, rider earning)
// use live settings without a database round-trip each time.
//
// CACHING, AND WHY IT IS SAFE TO BE SLIGHTLY STALE:
// getSettings() serves from an in-process cache for CACHE_TTL_MS, then re-reads.
// A local write refreshes the cache immediately, so the operator who just saved
// always sees their own change. On a multi-instance deployment another
// instance's write is picked up within the TTL — which is why the TTL is short.
// Being briefly stale is acceptable here and nowhere else in the codebase: the
// worst case is one order priced at the previous tax rate, or one rider earning
// computed at the previous per-km rate, seconds after a change. Both are
// snapshotted onto their own record, so nothing is retroactively wrong — it is
// the same "priced at the moment it happened" guarantee the platform already
// gives. What would NOT be acceptable is caching an authorization or status
// decision, and this cache holds neither.
const CACHE_TTL_MS = 30 * 1000;

let cache = null;
let cachedAt = 0;

// Exposed for tests, which need a cold cache between cases rather than a
// 30-second wait. Not reachable from any route.
function clearCache() {
  cache = null;
  cachedAt = 0;
}

function isFresh() {
  return cache !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

function prime(doc) {
  cache = doc;
  cachedAt = Date.now();
  return doc;
}

// Creates the singleton on first use. upsert (rather than findOne-then-create)
// so two concurrent first requests cannot both try to insert: the unique index on
// `key` makes one of them lose, and $setOnInsert means the loser still ends up
// reading the same document instead of erroring. Mongoose applies the schema
// defaults on insert, so the created row is exactly DEFAULTS.
async function loadSettings() {
  const doc = await PlatformSetting.findOneAndUpdate(
    { key: PlatformSetting.SETTINGS_KEY },
    { $setOnInsert: { key: PlatformSetting.SETTINGS_KEY } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );
  return prime(doc);
}

async function getSettings() {
  if (isFresh()) return cache;
  return loadSettings();
}

// Called once at boot (server.js) purely so the first real request does not pay
// for the document creation. A failure here is logged and swallowed: the app must
// still start, and getSettings() will create the row on first use anyway.
async function warmCache() {
  try {
    await loadSettings();
  } catch (err) {
    console.error('Platform settings cache warm failed (will load on first use):', err.message);
  }
}

// ---------------------------------------------------------------------------
// Typed accessors used by the pricing and earning paths. Each one returns plain
// numbers, never the Mongoose document, so a caller cannot accidentally mutate
// the cached object and have it treated as saved.
// ---------------------------------------------------------------------------

async function getTaxRate() {
  const settings = await getSettings();
  return settings.pricing.taxRate;
}

// The shape deliveryEarning.service.js#calculateEarning expects. Kept as one
// object so a single settings read covers the whole calculation and no two parts
// of one rider's earning can come from different versions of the config.
async function getDeliveryRates() {
  const settings = await getSettings();
  const d = settings.delivery;
  return {
    baseEarning: d.baseEarning,
    perKmRate: d.perKmRate,
    minEarning: d.minEarning,
    maxEarning: d.maxEarning === undefined ? null : d.maxEarning,
    incentives: {
      longDistance: {
        enabled: d.incentives.longDistance.enabled,
        thresholdKm: d.incentives.longDistance.thresholdKm,
        bonusAmount: d.incentives.longDistance.bonusAmount,
      },
      peakHour: {
        enabled: d.incentives.peakHour.enabled,
        bonusAmount: d.incentives.peakHour.bonusAmount,
        windows: d.incentives.peakHour.windows.map((w) => ({ startHour: w.startHour, endHour: w.endHour })),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Updating
// ---------------------------------------------------------------------------

// Every editable path, as dot-notation. An update body is filtered through this
// allow-list, so a request can never $set something the operator has no business
// setting (`version`, `key`, `updatedBy`, `createdAt`) even if the validator
// layer were bypassed — the same "whitelisted fields only, never a raw client
// filter object" rule audit.service.js#listLogs already follows.
const EDITABLE_PATHS = Object.freeze([
  'pricing.taxRate',
  'delivery.baseEarning',
  'delivery.perKmRate',
  'delivery.minEarning',
  'delivery.maxEarning',
  'delivery.incentives.longDistance.enabled',
  'delivery.incentives.longDistance.thresholdKm',
  'delivery.incentives.longDistance.bonusAmount',
  'delivery.incentives.peakHour.enabled',
  'delivery.incentives.peakHour.bonusAmount',
  'delivery.incentives.peakHour.windows',
]);

function getAtPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc === null || acc === undefined ? undefined : acc[key]), obj);
}

function setAtPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((acc, key) => acc[key], obj);
  target[last] = value;
}

// Only the paths actually present in the request body are touched, so a PATCH
// carrying one field cannot reset the rest to their defaults.
function collectChanges(doc, patch) {
  const changes = [];
  EDITABLE_PATHS.forEach((path) => {
    const incoming = getAtPath(patch, path);
    if (incoming === undefined) return;
    const current = getAtPath(doc, path);
    const before = path.endsWith('windows') ? JSON.stringify((current || []).map((w) => ({ startHour: w.startHour, endHour: w.endHour }))) : current;
    const after = path.endsWith('windows') ? JSON.stringify(incoming) : incoming;
    if (String(before) === String(after)) return; // no-op field, not worth an audit line
    changes.push({ path, from: current, to: incoming });
  });
  return changes;
}

// `expectedVersion` implements the optimistic-concurrency check described on the
// model. It is required, not optional: making it optional would mean the careless
// caller (the one most likely to clobber someone) is the one who skips the check.
//
// A no-op update (every field already equal) is NOT an error and does NOT bump
// the version — it returns the document unchanged and writes no audit entry, so
// an operator pressing Save twice does not invalidate a colleague's open form.
async function updateSettings(patch, expectedVersion, { actor, req } = {}) {
  const doc = await getSettings();

  if (expectedVersion !== doc.version) {
    throw ApiError.conflict(
      `These settings were changed by someone else (you have version ${expectedVersion}, current is ${doc.version}). Reload and reapply your change.`
    );
  }

  const changes = collectChanges(doc, patch);
  if (changes.length === 0) return doc;

  changes.forEach(({ path, to }) => setAtPath(doc, path, to));
  doc.version = doc.version + 1;
  doc.updatedBy = actor ? actor._id : null;

  try {
    await doc.save();
  } catch (err) {
    // A pre-validate invariant failure (minEarning > maxEarning, an empty peak
    // window) is the operator's mistake, not a server fault — surface it as a
    // 400 with the model's own message rather than a 500. The cache is dropped
    // because `doc` IS the cached object and now holds unsaved mutations.
    clearCache();
    if (err.name === 'ValidationError') {
      const message = Object.values(err.errors || {})
        .map((e) => e.message)
        .join('; ');
      throw ApiError.badRequest(message || err.message);
    }
    throw ApiError.badRequest(err.message);
  }

  prime(doc);

  // One audit entry per save, listing every field that actually moved. Rates are
  // money rules, so who changed what and when has to be reconstructable — the
  // same reason M11 audits every admin action.
  await auditService.record({
    req,
    actor,
    action: 'settings.update',
    entityType: 'PlatformSetting',
    entityId: doc._id,
    metadata: { version: doc.version, changes },
  });

  return doc;
}

module.exports = {
  CACHE_TTL_MS,
  EDITABLE_PATHS,
  loadSettings,
  getSettings,
  warmCache,
  clearCache,
  getTaxRate,
  getDeliveryRates,
  updateSettings,
};
