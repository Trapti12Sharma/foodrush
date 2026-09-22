require('./setup');
const Restaurant = require('../src/models/Restaurant');
const {
  parseTime, formatTime, isValidTimezone, normalizeSlots, serializeSlots, isOpenNow, openNowExpression, MAX_SLOTS,
} = require('../src/utils/openingHours');

// Instants verified independently with Node's own Intl formatter before writing these
// tests (see the session log) — each comment states the LOCAL weekday/time it corresponds
// to in Asia/Kolkata (UTC+5:30, no DST), which is what every scenario below is built around.
const MON_10_00 = new Date('2027-03-15T04:30:00Z'); // Mon 10:00 IST
const MON_23_00 = new Date('2027-03-15T17:30:00Z'); // Mon 23:00 IST
const MON_08_00 = new Date('2027-03-15T02:30:00Z'); // Mon 08:00 IST
const FRI_19_30 = new Date('2027-03-19T14:00:00Z'); // Fri 19:30 IST
const SAT_01_00 = new Date('2027-03-19T19:30:00Z'); // Sat 01:00 IST (tail of Friday's overnight slot)
const SAT_03_00 = new Date('2027-03-19T21:30:00Z'); // Sat 03:00 IST
const FRI_17_30 = new Date('2027-03-19T12:00:00Z'); // Fri 17:30 IST (before the overnight slot opens)
const MON_13_00 = new Date('2027-03-15T07:30:00Z'); // Mon 13:00 IST (lunch)
const MON_16_00 = new Date('2027-03-15T10:30:00Z'); // Mon 16:00 IST (between lunch and dinner)
const MON_19_00 = new Date('2027-03-15T13:30:00Z'); // Mon 19:00 IST (dinner)

const MON = 1;
const FRI = 5;
const SAT = 6;

describe('parseTime / formatTime', () => {
  it('round-trips valid 24-hour times', () => {
    expect(parseTime('09:30')).toBe(570);
    expect(parseTime('00:00')).toBe(0);
    expect(parseTime('23:59')).toBe(1439);
    expect(formatTime(570)).toBe('09:30');
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(1439)).toBe('23:59');
  });

  it('rejects malformed or out-of-range times', () => {
    ['24:00', '9:30', '09:60', '9:3', 'noon', '', null, undefined, '01:00:00'].forEach((v) => expect(parseTime(v)).toBeNull());
  });
});

describe('isValidTimezone', () => {
  it('accepts real IANA zones and rejects nonsense', () => {
    ['Asia/Kolkata', 'America/New_York', 'UTC', 'Etc/GMT+4'].forEach((tz) => expect(isValidTimezone(tz)).toBe(true));
    ['Mars/Colony', 'Asia/NotACity', 'GMT+5:30', '', 123, 'x'.repeat(61)].forEach((tz) => expect(isValidTimezone(tz)).toBe(false));
  });
});

describe('normalizeSlots', () => {
  it('accepts a well-formed schedule, including multiple slots per day', () => {
    const { slots, error } = normalizeSlots([{ day: 1, open: '12:00', close: '15:00' }, { day: 1, open: '18:00', close: '23:00' }]);
    expect(error).toBeUndefined();
    expect(slots).toEqual([{ day: 1, open: 720, close: 900 }, { day: 1, open: 1080, close: 1380 }]);
  });

  it('accepts an overnight slot (close <= open)', () => {
    const { slots, error } = normalizeSlots([{ day: 5, open: '18:00', close: '02:00' }]);
    expect(error).toBeUndefined();
    expect(slots).toEqual([{ day: 5, open: 1080, close: 120 }]);
  });

  it('treats an empty list as "no schedule" (always open) without error', () => {
    expect(normalizeSlots([])).toEqual({ slots: [] });
  });

  it('rejects the wrong shape, bad day/time values, a same open/close time, and too many slots', () => {
    expect(normalizeSlots('not an array').error).toMatch(/list of slots/);
    expect(normalizeSlots([{ day: 7, open: '09:00', close: '10:00' }]).error).toMatch(/day from 0/);
    expect(normalizeSlots([{ day: -1, open: '09:00', close: '10:00' }]).error).toMatch(/day from 0/);
    expect(normalizeSlots([{ day: 1, open: '9:00', close: '10:00' }]).error).toMatch(/HH:MM/);
    expect(normalizeSlots([{ day: 1, open: '09:00', close: '09:00' }]).error).toMatch(/same time/);
    expect(normalizeSlots(Array.from({ length: MAX_SLOTS + 1 }, () => ({ day: 1, open: '09:00', close: '10:00' }))).error).toMatch(/At most/);
  });

  it('rejects overlapping slots on the same day, including an overnight slot overlapping the next morning', () => {
    expect(normalizeSlots([{ day: 1, open: '09:00', close: '15:00' }, { day: 1, open: '14:00', close: '20:00' }]).error).toMatch(/overlap/);
    // Friday 18:00 -> 02:00 spills into Saturday 00:00-02:00, which collides with a Saturday-morning slot.
    expect(
      normalizeSlots([{ day: 5, open: '18:00', close: '02:00' }, { day: 6, open: '01:00', close: '06:00' }]).error
    ).toMatch(/overlap/);
    // ...but does not falsely collide with a slot that starts right at 02:00.
    expect(
      normalizeSlots([{ day: 5, open: '18:00', close: '02:00' }, { day: 6, open: '02:00', close: '06:00' }]).error
    ).toBeUndefined();
  });

  it('does not falsely flag identical non-overlapping slots on different days as overlapping', () => {
    expect(normalizeSlots([{ day: 1, open: '09:00', close: '22:00' }, { day: 2, open: '09:00', close: '22:00' }]).error).toBeUndefined();
  });
});

describe('serializeSlots', () => {
  it('converts stored minutes back to HH:MM, and defaults to an empty list', () => {
    expect(serializeSlots([{ day: 1, open: 570, close: 1320 }])).toEqual([{ day: 1, open: '09:30', close: '22:00' }]);
    expect(serializeSlots()).toEqual([]);
  });
});

describe('isOpenNow', () => {
  it('is always open when no schedule is set, unless manually paused', () => {
    expect(isOpenNow({ openingHours: [], isOpen: true }, MON_10_00)).toBe(true);
    expect(isOpenNow({ openingHours: [], isOpen: true }, MON_23_00)).toBe(true);
    expect(isOpenNow({ openingHours: [], isOpen: false }, MON_10_00)).toBe(false);
    expect(isOpenNow({}, MON_10_00)).toBe(true); // no openingHours field at all — same as []
  });

  it('honours a same-day slot, closed just before and at closing time', () => {
    const restaurant = { openingHours: [{ day: MON, open: parseTime('09:00'), close: parseTime('22:00') }], isOpen: true };
    expect(isOpenNow(restaurant, MON_10_00)).toBe(true);
    expect(isOpenNow(restaurant, MON_08_00)).toBe(false);
    expect(isOpenNow(restaurant, MON_23_00)).toBe(false); // 23:00 is after the 22:00 close
  });

  it('handles multiple slots on the same day (lunch and dinner)', () => {
    const restaurant = {
      openingHours: [
        { day: MON, open: parseTime('12:00'), close: parseTime('15:00') },
        { day: MON, open: parseTime('18:00'), close: parseTime('23:00') },
      ],
      isOpen: true,
    };
    expect(isOpenNow(restaurant, MON_13_00)).toBe(true);
    expect(isOpenNow(restaurant, MON_16_00)).toBe(false);
    expect(isOpenNow(restaurant, MON_19_00)).toBe(true);
  });

  it('handles an overnight slot correctly on both sides of midnight', () => {
    const restaurant = { openingHours: [{ day: FRI, open: parseTime('18:00'), close: parseTime('02:00') }], isOpen: true };
    expect(isOpenNow(restaurant, FRI_17_30)).toBe(false); // before it opens
    expect(isOpenNow(restaurant, FRI_19_30)).toBe(true); // Friday evening
    expect(isOpenNow(restaurant, SAT_01_00)).toBe(true); // the Saturday-morning tail
    expect(isOpenNow(restaurant, SAT_03_00)).toBe(false); // after it closes
  });

  it('the manual pause always wins, even during an open slot', () => {
    const restaurant = { openingHours: [{ day: MON, open: parseTime('09:00'), close: parseTime('22:00') }], isOpen: false };
    expect(isOpenNow(restaurant, MON_10_00)).toBe(false);
  });

  it('applies the restaurant\'s own timezone, defaulting to Asia/Kolkata', () => {
    // A schedule of Monday 00:00-01:00 is open at this instant in Etc/GMT+4 (00:30 there)
    // but not in Asia/Kolkata (10:00 there) — same instant, different answer per restaurant.
    const slot = [{ day: MON, open: parseTime('00:00'), close: parseTime('01:00') }];
    expect(isOpenNow({ openingHours: slot, isOpen: true, timezone: 'Etc/GMT+4' }, MON_10_00)).toBe(true);
    expect(isOpenNow({ openingHours: slot, isOpen: true }, MON_10_00)).toBe(false); // default timezone: Kolkata
    expect(isOpenNow({ openingHours: slot, isOpen: true, timezone: 'Asia/Kolkata' }, MON_10_00)).toBe(false);
  });
});

// The nearby-search aggregation (restaurantGeo.service.js) can't call the JS isOpenNow()
// function — it has to express the same rule for MongoDB to evaluate per document. These
// tests run BOTH implementations against the same restaurant documents and instants, so
// they can never silently drift apart.
describe('openNowExpression matches isOpenNow (JS vs. aggregation)', () => {
  const scenarios = [
    { label: 'no schedule, open', doc: { openingHours: [], isOpen: true }, at: MON_10_00 },
    { label: 'no schedule, paused', doc: { openingHours: [], isOpen: false }, at: MON_10_00 },
    { label: 'same-day slot, inside', doc: { openingHours: [{ day: MON, open: parseTime('09:00'), close: parseTime('22:00') }], isOpen: true }, at: MON_10_00 },
    { label: 'same-day slot, outside', doc: { openingHours: [{ day: MON, open: parseTime('09:00'), close: parseTime('22:00') }], isOpen: true }, at: MON_23_00 },
    { label: 'lunch/dinner gap', doc: { openingHours: [{ day: MON, open: parseTime('12:00'), close: parseTime('15:00') }, { day: MON, open: parseTime('18:00'), close: parseTime('23:00') }], isOpen: true }, at: MON_16_00 },
    { label: 'overnight, evening side', doc: { openingHours: [{ day: FRI, open: parseTime('18:00'), close: parseTime('02:00') }], isOpen: true }, at: FRI_19_30 },
    { label: 'overnight, morning-after tail', doc: { openingHours: [{ day: FRI, open: parseTime('18:00'), close: parseTime('02:00') }], isOpen: true }, at: SAT_01_00 },
    { label: 'overnight, after close', doc: { openingHours: [{ day: FRI, open: parseTime('18:00'), close: parseTime('02:00') }], isOpen: true }, at: SAT_03_00 },
    { label: 'paused during an open slot', doc: { openingHours: [{ day: MON, open: parseTime('09:00'), close: parseTime('22:00') }], isOpen: false }, at: MON_10_00 },
    { label: 'non-default timezone', doc: { openingHours: [{ day: MON, open: parseTime('00:00'), close: parseTime('01:00') }], isOpen: true, timezone: 'Etc/GMT+4' }, at: MON_10_00 },
  ];

  it('agrees with the JavaScript implementation on every scenario', async () => {
    const owner = new Restaurant()._id; // any ObjectId — no User needed for this check
    const created = await Restaurant.create(
      scenarios.map((s, i) => ({
        name: `Scenario ${i}`, owner, cuisine: ['Test'], address: { addressLine: '1 St' }, city: 'Test City', deliveryTime: 20,
        openingHours: s.doc.openingHours, isOpen: s.doc.isOpen, timezone: s.doc.timezone,
      }))
    );

    for (const [i, s] of scenarios.entries()) {
      const expected = isOpenNow(s.doc, s.at);
      // eslint-disable-next-line no-await-in-loop
      const [row] = await Restaurant.aggregate([
        { $match: { _id: created[i]._id } },
        { $addFields: { isOpenNow: openNowExpression(s.at) } },
        { $project: { isOpenNow: 1 } },
      ]);
      expect([s.label, row.isOpenNow]).toEqual([s.label, expected]);
    }
  });
});
