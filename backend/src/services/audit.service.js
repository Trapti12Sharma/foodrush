const AuditLog = require('../models/AuditLog');
const ApiError = require('../utils/ApiError');
const { parsePagination, buildPaginationMeta } = require('../utils/pagination');

// Anything whose key looks like a credential is replaced before storage, so an
// audit trail can never become a place secrets leak from.
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|otp|api[-_]?key|signature|card|cvv|account[-_]?number|ifsc/i;
const MAX_DEPTH = 4;
const MAX_STRING = 500;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    if (typeof value.toHexString === 'function') return value.toHexString(); // ObjectId
    if (value instanceof Date) return value;
    const out = {};
    Object.entries(value).forEach(([key, v]) => {
      out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
    });
    return out;
  }
  return value;
}

// Best-effort by design: a failure to write the audit entry is logged (message
// only, never the payload) but must not fail the admin action it describes.
async function record({ req, actor, action, entityType, entityId, metadata }) {
  try {
    const user = actor || req?.user || null;
    await AuditLog.create({
      actor: user ? user._id : null,
      actorRole: user ? user.role : null,
      action,
      entityType: entityType || null,
      entityId: entityId || null,
      metadata: redact(metadata || {}),
      ip: req?.ip || null,
      userAgent: req?.headers?.['user-agent']?.slice(0, 300) || null,
    });
  } catch (err) {
    console.error(`Audit log write failed for "${action}":`, err.message);
  }
}

async function listLogs(query) {
  const { page, limit, skip } = parsePagination(query);
  // Whitelisted fields only — never a raw client-supplied filter object, so this
  // can never become a way to run an arbitrary Mongo query against the audit trail.
  const filter = {};
  if (query.action) filter.action = query.action;
  if (query.actor) filter.actor = query.actor;
  if (query.actorRole) filter.actorRole = query.actorRole;
  if (query.entityType) filter.entityType = query.entityType;
  if (query.entityId) filter.entityId = query.entityId;
  if (query.from || query.to) {
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = new Date(query.from);
    if (query.to) filter.createdAt.$lte = new Date(query.to);
  }

  const [items, total] = await Promise.all([
    AuditLog.find(filter).sort('-createdAt').skip(skip).limit(limit).populate('actor', 'name email role'),
    AuditLog.countDocuments(filter),
  ]);
  return { items, pagination: buildPaginationMeta(total, page, limit) };
}

async function getLogById(id) {
  const entry = await AuditLog.findById(id).populate('actor', 'name email role');
  if (!entry) throw ApiError.notFound('Audit log entry not found');
  return entry;
}

module.exports = { record, listLogs, getLogById, redact };
