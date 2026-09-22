// Opening hours.
//
// A restaurant's weekly schedule is a flat list of slots: { day, open, close } where
//   day   0 = Sunday … 6 = Saturday, in the RESTAURANT's own timezone
//   open  / close  minutes since midnight (stored as numbers; the API speaks "HH:MM")
// A slot whose close is not after its open (e.g. 18:00 -> 02:00) is OVERNIGHT: it runs from
// `open` on `day` to `close` on the following day. Several slots on one day are allowed
// (lunch + dinner). No slots at all means "no schedule set" — always open, which is exactly
// how every restaurant behaved before opening hours existed. The separate manual `isOpen`
// flag is a "pause" switch that always wins.
//
// isOpenNow() (JavaScript) and openNowExpression() (MongoDB aggregation, used by the
// nearby search) implement the SAME rule; the tests run both over the same data.

const DEFAULT_TIMEZONE = 'Asia/Kolkata';
const MINUTES_PER_DAY = 1440;
const MAX_SLOTS = 28; // 7 days x 4 slots

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

// "09:30" -> 570.  Returns null for anything that isn't a valid 24-hour HH:MM.
function parseTime(text) {
  const match = TIME_PATTERN.exec(String(text));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// 570 -> "09:30"
function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function isValidTimezone(timezone) {
  if (typeof timezone !== 'string' || timezone.length > 60) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }); // throws RangeError for an unknown zone
    return true;
  } catch {
    return false;
  }
}

const isOvernight = (slot) => slot.close <= slot.open;

// Where a slot sits on a 7-day circular minute line, so overlaps can be found across
// midnight and across the Saturday -> Sunday wrap.
function toWeekIntervals(slot) {
  const week = 7 * MINUTES_PER_DAY;
  const start = slot.day * MINUTES_PER_DAY + slot.open;
  const end = slot.day * MINUTES_PER_DAY + (isOvernight(slot) ? slot.close + MINUTES_PER_DAY : slot.close);
  return end > week ? [[start, week], [0, end - week]] : [[start, end]];
}

// API form ([{day, open:'HH:MM', close:'HH:MM'}]) -> stored form (minutes). Returns
// { slots } or { error } — used by the validator so messages reach the owner verbatim.
function normalizeSlots(input) {
  if (!Array.isArray(input)) return { error: 'openingHours must be a list of slots' };
  if (input.length > MAX_SLOTS) return { error: `At most ${MAX_SLOTS} opening-hour slots are allowed` };

  const slots = [];
  for (const raw of input) {
    const day = Number(raw?.day);
    const open = parseTime(raw?.open);
    const close = parseTime(raw?.close);
    if (!Number.isInteger(day) || day < 0 || day > 6) return { error: 'Each slot needs a day from 0 (Sunday) to 6 (Saturday)' };
    if (open === null || close === null) return { error: 'Opening and closing times must be in 24-hour HH:MM format' };
    if (open === close) return { error: 'A slot cannot open and close at the same time' };
    slots.push({ day, open, close });
  }

  const intervals = slots.flatMap((slot, index) => toWeekIntervals(slot).map(([start, end]) => ({ index, start, end })));
  for (let a = 0; a < intervals.length; a += 1) {
    for (let b = a + 1; b < intervals.length; b += 1) {
      if (intervals[a].index !== intervals[b].index && intervals[a].start < intervals[b].end && intervals[b].start < intervals[a].end) {
        return { error: 'Opening-hour slots must not overlap' };
      }
    }
  }
  return { slots };
}

// Stored form -> API form.
function serializeSlots(slots = []) {
  return slots.map((s) => ({ day: s.day, open: formatTime(s.open), close: formatTime(s.close) }));
}

// The current weekday (0 = Sunday) and minute of day in `timezone`.
function localParts(now, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

// Is this restaurant taking orders right now?
function isOpenNow(restaurant, now = new Date()) {
  if (restaurant.isOpen === false) return false; // manually paused
  const slots = restaurant.openingHours || [];
  if (slots.length === 0) return true; // no schedule = always open

  const { day, minute } = localParts(now, restaurant.timezone || DEFAULT_TIMEZONE);
  const previousDay = (day + 6) % 7;
  return slots.some((slot) => {
    if (slot.day === day && minute >= slot.open && minute < (isOvernight(slot) ? MINUTES_PER_DAY : slot.close)) return true;
    // the tail of yesterday's overnight slot, e.g. 00:30 belongs to Friday 18:00 -> 02:00
    return isOvernight(slot) && slot.day === previousDay && minute < slot.close;
  });
}

// The same rule as a MongoDB aggregation expression, evaluated per restaurant document in
// that restaurant's own timezone. `now` is passed in (rather than using $$NOW) so the result
// is deterministic and testable.
function openNowExpression(now) {
  const tz = { $ifNull: ['$timezone', DEFAULT_TIMEZONE] };
  const day = { $subtract: [{ $dayOfWeek: { date: now, timezone: tz } }, 1] }; // $dayOfWeek: 1 = Sunday
  const minute = { $add: [{ $multiply: [{ $hour: { date: now, timezone: tz } }, 60] }, { $minute: { date: now, timezone: tz } }] };
  const slots = { $ifNull: ['$openingHours', []] };

  const inSlot = {
    $anyElementTrue: {
      $map: {
        input: slots,
        as: 's',
        in: {
          $or: [
            {
              $and: [
                { $eq: ['$$s.day', '$$day'] },
                { $gte: ['$$minute', '$$s.open'] },
                { $lt: ['$$minute', { $cond: [{ $gt: ['$$s.close', '$$s.open'] }, '$$s.close', MINUTES_PER_DAY] }] },
              ],
            },
            {
              $and: [
                { $lte: ['$$s.close', '$$s.open'] },
                { $eq: ['$$s.day', { $mod: [{ $add: ['$$day', 6] }, 7] }] },
                { $lt: ['$$minute', '$$s.close'] },
              ],
            },
          ],
        },
      },
    },
  };

  return {
    $cond: [
      { $eq: ['$isOpen', false] },
      false,
      { $cond: [{ $eq: [{ $size: slots }, 0] }, true, { $let: { vars: { day, minute }, in: inSlot } }] },
    ],
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  MAX_SLOTS,
  parseTime,
  formatTime,
  isValidTimezone,
  normalizeSlots,
  serializeSlots,
  isOpenNow,
  openNowExpression,
};
