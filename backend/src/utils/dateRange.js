const ApiError = require('./ApiError');

// M16 — the single date-range parser every analytics endpoint uses, so two
// endpoints can never silently interpret "last7days" differently.
//
// TIMEZONE: everything here is UTC, deliberately and explicitly. The existing
// admin dashboard already buckets days with $dateToString (which defaults to
// UTC) and builds its day keys with toISOString(), so UTC is the convention
// already in the database layer — analytics matching it means a day bucket
// returned by an aggregation and a day boundary computed here always agree.
// (The pre-M16 owner dashboard's `todayOrders` uses server-local midnight via
// setHours(); that endpoint is untouched, and nothing here depends on it.)
//
// RANGES ARE HALF-OPEN: [start, end) — start inclusive, end exclusive. That is
// what keeps "today" from either dropping the last millisecond before midnight
// or bleeding into tomorrow, which a naive inclusive `$lte endOfDay` does.
// A caller asking for the custom range 2026-03-01..2026-03-31 gets
// start=2026-03-01T00:00:00.000Z, end=2026-04-01T00:00:00.000Z — the whole of
// the 31st included, nothing from April.

const PRESETS = Object.freeze([
  'today',
  'yesterday',
  'last7days',
  'last30days',
  'thismonth',
  'lastmonth',
  'alltime',
  'custom',
]);

// Midnight UTC at the start of the UTC day `date` falls in.
function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

// Accepts YYYY-MM-DD (interpreted as midnight UTC that day) or a full ISO
// timestamp. Anything else is a 422-worthy client error, never silently
// coerced — `new Date('rubbish')` yielding Invalid Date must not reach a
// pipeline, where it would throw deep inside Mongo instead.
function parseDateInput(raw, field) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw ApiError.badRequest(`${field} must be a date (YYYY-MM-DD or an ISO timestamp)`);
  }
  const trimmed = raw.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const parsed = new Date(dateOnly ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw ApiError.badRequest(`${field} is not a valid date`);
  }
  return { date: parsed, dateOnly };
}

// `now` is injectable purely so tests can pin "today" deterministically.
function parseDateRange(query = {}, now = new Date()) {
  const preset = (query.preset || (query.startDate || query.endDate ? 'custom' : 'last30days')).toLowerCase();

  if (!PRESETS.includes(preset)) {
    throw ApiError.badRequest(`preset must be one of: ${PRESETS.join(', ')}`);
  }

  const todayStart = startOfUtcDay(now);
  const tomorrowStart = addUtcDays(todayStart, 1);

  switch (preset) {
    case 'today':
      return { preset, start: todayStart, end: tomorrowStart };

    case 'yesterday':
      return { preset, start: addUtcDays(todayStart, -1), end: todayStart };

    // "Last 7 days" includes today, so it is 6 days back through end of today —
    // matching the existing admin dashboard's last7Days series exactly.
    case 'last7days':
      return { preset, start: addUtcDays(todayStart, -6), end: tomorrowStart };

    case 'last30days':
      return { preset, start: addUtcDays(todayStart, -29), end: tomorrowStart };

    case 'thismonth':
      return {
        preset,
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
        end: tomorrowStart,
      };

    case 'lastmonth':
      return {
        preset,
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
        end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      };

    // No date filter at all — `start: null` tells callers to omit the range
    // predicate entirely rather than guessing an arbitrary epoch start.
    case 'alltime':
      return { preset, start: null, end: null };

    case 'custom':
    default: {
      if (!query.startDate || !query.endDate) {
        throw ApiError.badRequest('A custom range requires both startDate and endDate');
      }
      const { date: start } = parseDateInput(query.startDate, 'startDate');
      const { date: rawEnd, dateOnly: endIsDateOnly } = parseDateInput(query.endDate, 'endDate');

      // A bare end DATE means "through the end of that day", so it becomes the
      // following midnight for the half-open range. A full timestamp is taken
      // literally — the caller was explicit about the instant they meant.
      const end = endIsDateOnly ? addUtcDays(rawEnd, 1) : rawEnd;

      if (start >= end) {
        throw ApiError.badRequest('startDate must be before endDate');
      }
      return { preset, start, end };
    }
  }
}

// The `createdAt` filter fragment for a parsed range — `{}` for alltime, so it
// can always be spread into a $match without a conditional at every call site.
function rangeFilter(range, field = 'createdAt') {
  if (!range || !range.start) return {};
  return { [field]: { $gte: range.start, $lt: range.end } };
}

// Every UTC day in the range as YYYY-MM-DD, so a trend series can report days
// with zero activity instead of silently omitting them (a chart with missing
// days misreads as a chart with different days). Capped to keep a hostile
// `startDate=1970-01-01` from generating an unbounded array.
const MAX_TREND_DAYS = 400;

function eachUtcDay(range) {
  if (!range || !range.start) return [];
  const days = [];
  let cursor = startOfUtcDay(range.start);
  const last = range.end;
  while (cursor < last && days.length < MAX_TREND_DAYS) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor = addUtcDays(cursor, 1);
  }
  return days;
}

module.exports = { PRESETS, parseDateRange, rangeFilter, eachUtcDay, startOfUtcDay, addUtcDays, MAX_TREND_DAYS };
