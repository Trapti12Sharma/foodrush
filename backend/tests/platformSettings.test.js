require('./setup');
const request = require('supertest');
const { app, registerAndLogin, uniqueEmail, createUserWithRole, setupOrderable } = require('./helpers');
const PlatformSetting = require('../src/models/PlatformSetting');
const AuditLog = require('../src/models/AuditLog');
const platformSettingService = require('../src/services/platformSetting.service');
const deliveryEarningService = require('../src/services/deliveryEarning.service');
const pricing = require('../src/services/pricing.service');

// M17 — platform settings: the admin-editable tax rate and delivery-earning
// rates/incentives.
//
// The service caches settings for 30s, and setup.js wipes every collection after
// each test, so the cache MUST be dropped between tests or a case would read a
// document that no longer exists. Jest gives each test file its own module
// registry, so this cache is private to this file and cannot leak into
// cart/order/earning tests running in the same in-band process.
beforeEach(() => platformSettingService.clearCache());
afterEach(() => platformSettingService.clearCache());

async function superAdmin() {
  const { agent, user } = await createUserWithRole('SUPER_ADMIN', 'settings-sa');
  return { agent, user };
}

// Reads the settings so a PATCH can send the version it actually saw, which is
// what a real client does.
async function currentVersion(agent) {
  const res = await agent.get('/api/admin/settings');
  return res.body.data.settings.version;
}

describe('M17 platform settings — access control', () => {
  it('lets a SUPER_ADMIN read the settings', async () => {
    const { agent } = await superAdmin();
    const res = await agent.get('/api/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body.data.settings.pricing.taxRate).toBe(0.05);
  });

  // The whole reason SUPER_ADMIN and ADMIN are separate roles: an ADMIN runs the
  // marketplace day to day but cannot change what customers are taxed or what
  // riders are paid.
  it('refuses an ADMIN, who does not hold settings:manage', async () => {
    const { agent } = await createUserWithRole('ADMIN', 'settings-admin');
    expect((await agent.get('/api/admin/settings')).status).toBe(403);
    expect((await agent.patch('/api/admin/settings').send({ version: 1, pricing: { taxRate: 0.2 } })).status).toBe(403);
  });

  it.each([
    ['OPERATIONS_MANAGER', 'settings-ops'],
    ['RESTAURANT_MANAGER', 'settings-rm'],
    ['DELIVERY_MANAGER', 'settings-dm'],
    ['SUPPORT_AGENT', 'settings-sup'],
  ])('refuses %s', async (role, prefix) => {
    const { agent } = await createUserWithRole(role, prefix);
    expect((await agent.get('/api/admin/settings')).status).toBe(403);
  });

  it('refuses a customer and a restaurant owner', async () => {
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('settings-cust'), role: 'CUSTOMER' });
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('settings-owner'), role: 'RESTAURANT_OWNER' });
    expect((await customer.get('/api/admin/settings')).status).toBe(403);
    expect((await owner.get('/api/admin/settings')).status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(app).get('/api/admin/settings')).status).toBe(401);
  });
});

describe('M17 platform settings — the singleton and its defaults', () => {
  it('creates the document with platform defaults on first read', async () => {
    expect(await PlatformSetting.countDocuments({})).toBe(0);
    const { agent } = await superAdmin();
    const res = await agent.get('/api/admin/settings');

    expect(res.status).toBe(200);
    const s = res.body.data.settings;
    expect(s.version).toBe(1);
    expect(s.pricing.taxRate).toBe(0.05); // exactly the rate pricing.service.js always applied
    expect(s.delivery.baseEarning).toBe(deliveryEarningService.BASE_EARNING);
    expect(s.delivery.perKmRate).toBe(deliveryEarningService.PER_KM_RATE);
    expect(s.delivery.minEarning).toBe(deliveryEarningService.MIN_EARNING);
    // Both incentive rules ship OFF, so adding this feature changed nobody's pay.
    expect(s.delivery.incentives.longDistance.enabled).toBe(false);
    expect(s.delivery.incentives.peakHour.enabled).toBe(false);
    expect(await PlatformSetting.countDocuments({})).toBe(1);
  });

  it('never creates a second document, however many concurrent first reads arrive', async () => {
    const { agent } = await superAdmin();
    platformSettingService.clearCache();
    // Concurrent cold reads: the upsert plus the unique index on `key` means the
    // losers read the winner's document rather than inserting their own.
    await Promise.all([
      platformSettingService.loadSettings(),
      platformSettingService.loadSettings(),
      platformSettingService.loadSettings(),
      agent.get('/api/admin/settings'),
    ]);
    expect(await PlatformSetting.countDocuments({})).toBe(1);
  });
});

describe('M17 platform settings — updating', () => {
  it('updates one field, bumps the version, and leaves every other field alone', async () => {
    const { agent, user } = await superAdmin();
    const before = (await agent.get('/api/admin/settings')).body.data.settings;

    const res = await agent.patch('/api/admin/settings').send({ version: before.version, pricing: { taxRate: 0.08 } });

    expect(res.status).toBe(200);
    const after = res.body.data.settings;
    expect(after.pricing.taxRate).toBe(0.08);
    expect(after.version).toBe(before.version + 1);
    expect(after.updatedBy).toBe(user._id.toString());
    // A partial update must not reset the fields it did not mention.
    expect(after.delivery.baseEarning).toBe(before.delivery.baseEarning);
    expect(after.delivery.perKmRate).toBe(before.delivery.perKmRate);
    expect(after.delivery.incentives.longDistance.thresholdKm).toBe(before.delivery.incentives.longDistance.thresholdKm);
  });

  it('requires the version, rather than treating its absence as a force-overwrite', async () => {
    const { agent } = await superAdmin();
    await agent.get('/api/admin/settings');
    const res = await agent.patch('/api/admin/settings').send({ pricing: { taxRate: 0.08 } });
    expect(res.status).toBe(422);
    // Nothing was written.
    expect((await agent.get('/api/admin/settings')).body.data.settings.pricing.taxRate).toBe(0.05);
  });

  it('rejects a stale version with 409 and writes nothing', async () => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);

    // First editor wins.
    await agent.patch('/api/admin/settings').send({ version: v, pricing: { taxRate: 0.07 } }).expect(200);
    // Second editor was holding the same version on their screen.
    const res = await agent.patch('/api/admin/settings').send({ version: v, pricing: { taxRate: 0.09 } });

    expect(res.status).toBe(409);
    platformSettingService.clearCache();
    const now = (await agent.get('/api/admin/settings')).body.data.settings;
    expect(now.pricing.taxRate).toBe(0.07); // the loser's value never landed
    expect(now.version).toBe(v + 1); // and the version moved exactly once
  });

  it('treats a no-op save as success without bumping the version or auditing it', async () => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);

    const res = await agent.patch('/api/admin/settings').send({ version: v, pricing: { taxRate: 0.05 } });

    expect(res.status).toBe(200);
    expect(res.body.data.settings.version).toBe(v); // unchanged, so a colleague's open form stays valid
    expect(await AuditLog.countDocuments({ action: 'settings.update' })).toBe(0);
  });

  it('ignores fields outside the editable allow-list', async () => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);
    const fakeId = '0123456789abcdef01234567';

    const res = await agent.patch('/api/admin/settings').send({
      version: v,
      key: 'hacked',
      updatedBy: fakeId,
      createdAt: '1999-01-01T00:00:00.000Z',
      pricing: { taxRate: 0.06 },
    });

    expect(res.status).toBe(200);
    expect(res.body.data.settings.pricing.taxRate).toBe(0.06); // the legitimate change applied
    const stored = await PlatformSetting.findOne({});
    expect(stored.key).toBe('platform'); // not "hacked"
    expect(stored.updatedBy.toString()).not.toBe(fakeId); // attributed to the real actor
  });

  it('writes one audit entry naming every field that moved, with old and new values', async () => {
    const { agent, user } = await superAdmin();
    const v = await currentVersion(agent);

    await agent
      .patch('/api/admin/settings')
      .send({ version: v, pricing: { taxRate: 0.1 }, delivery: { perKmRate: 9 } })
      .expect(200);

    const entries = await AuditLog.find({ action: 'settings.update' });
    expect(entries).toHaveLength(1);
    expect(entries[0].actor.toString()).toBe(user._id.toString());
    expect(entries[0].entityType).toBe('PlatformSetting');
    const changed = entries[0].metadata.changes;
    expect(changed).toHaveLength(2);
    expect(changed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'pricing.taxRate', from: 0.05, to: 0.1 }),
        expect.objectContaining({ path: 'delivery.perKmRate', from: deliveryEarningService.PER_KM_RATE, to: 9 }),
      ])
    );
  });
});

describe('M17 platform settings — validation and invariants', () => {
  it.each([
    ['a tax rate above the 0.5 cap (a mistyped percentage)', { pricing: { taxRate: 5 } }],
    ['a negative tax rate', { pricing: { taxRate: -0.01 } }],
    ['a negative base earning', { delivery: { baseEarning: -1 } }],
    ['a non-numeric rate', { pricing: { taxRate: 'five percent' } }],
    ['a fractional peak hour', { delivery: { incentives: { peakHour: { windows: [{ startHour: 9.5, endHour: 11 }] } } } }],
    ['an out-of-range hour', { delivery: { incentives: { peakHour: { windows: [{ startHour: 9, endHour: 24 }] } } } }],
    ['a window missing endHour', { delivery: { incentives: { peakHour: { windows: [{ startHour: 9 }] } } } }],
    ['an empty window where start equals end', { delivery: { incentives: { peakHour: { windows: [{ startHour: 9, endHour: 9 }] } } } }],
  ])('rejects %s with 422', async (_label, patch) => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);
    const res = await agent.patch('/api/admin/settings').send({ version: v, ...patch });
    expect(res.status).toBe(422);
  });

  it('rejects more than 8 peak windows', async () => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);
    const windows = Array.from({ length: 9 }, (_, i) => ({ startHour: i, endHour: i + 1 }));
    const res = await agent.patch('/api/admin/settings').send({ version: v, delivery: { incentives: { peakHour: { windows } } } });
    expect(res.status).toBe(422);
  });

  // A cross-field rule, so it cannot be caught field-by-field in the validator —
  // the model enforces it, and the service turns it into a 400 with the model's
  // own message rather than a 500.
  it('rejects a floor above the ceiling with 400 and leaves the stored values untouched', async () => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);

    const res = await agent.patch('/api/admin/settings').send({ version: v, delivery: { minEarning: 500, maxEarning: 100 } });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/minEarning cannot be greater than.*maxEarning/i);
    platformSettingService.clearCache();
    const stored = await PlatformSetting.findOne({});
    expect(stored.delivery.minEarning).toBe(deliveryEarningService.MIN_EARNING);
    expect(stored.version).toBe(v); // the failed save did not bump the version
  });

  it('rejects enabling the peak-hour incentive with no windows', async () => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);
    const res = await agent
      .patch('/api/admin/settings')
      .send({ version: v, delivery: { incentives: { peakHour: { enabled: true, bonusAmount: 25 } } } });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/at least one window/i);
  });

  it('accepts null for maxEarning as "no cap", and distinguishes it from a cap of 0', async () => {
    const { agent } = await superAdmin();
    let v = await currentVersion(agent);

    await agent.patch('/api/admin/settings').send({ version: v, delivery: { maxEarning: 200 } }).expect(200);
    platformSettingService.clearCache();
    v = await currentVersion(agent);

    const removed = await agent.patch('/api/admin/settings').send({ version: v, delivery: { maxEarning: null } });
    expect(removed.status).toBe(200);
    expect(removed.body.data.settings.delivery.maxEarning).toBeNull();

    platformSettingService.clearCache();
    v = await currentVersion(agent);
    const zeroCap = await agent.patch('/api/admin/settings').send({ version: v, delivery: { minEarning: 0, maxEarning: 0 } });
    expect(zeroCap.status).toBe(200);
    expect(zeroCap.body.data.settings.delivery.maxEarning).toBe(0); // a real cap, not "unset"
  });
});

describe('M17 — the tax rate actually drives order totals', () => {
  it('prices a new cart and a new order with the configured rate', async () => {
    const { agent: admin } = await superAdmin();
    const v = await currentVersion(admin);
    await admin.patch('/api/admin/settings').send({ version: v, pricing: { taxRate: 0.1 } }).expect(200);

    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('tax-owner'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('tax-cust'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner, { price: 200, deliveryFee: 20 });

    const cart = await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    expect(cart.body.data.cart.tax).toBeCloseTo(20, 2); // 10% of 200, not the default 5%
    expect(cart.body.data.cart.total).toBeCloseTo(240, 2); // 200 + 20 delivery + 20 tax

    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    const order = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(order.status).toBe(201);
    expect(order.body.data.order.tax).toBeCloseTo(20, 2);
    expect(order.body.data.order.totalAmount).toBeCloseTo(240, 2);
  });

  it('never re-prices an order that was already placed', async () => {
    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('tax2-owner'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('tax2-cust'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner, { price: 200, deliveryFee: 0 });
    const addr = await customer.post('/api/addresses').send({ addressLine: '1 Rd', city: 'Pune', pincode: '411001' });
    await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });
    const placed = await customer.post('/api/orders').send({ addressId: addr.body.data.address._id, paymentMethod: 'COD' });
    expect(placed.body.data.order.tax).toBeCloseTo(10, 2); // 5% of 200

    const { agent: admin } = await superAdmin();
    const v = await currentVersion(admin);
    await admin.patch('/api/admin/settings').send({ version: v, pricing: { taxRate: 0.25 } }).expect(200);

    // The customer's own record of what they were charged is unchanged.
    const fetched = await customer.get(`/api/orders/${placed.body.data.order._id}`);
    expect(fetched.body.data.order.tax).toBeCloseTo(10, 2);
    expect(fetched.body.data.order.totalAmount).toBeCloseTo(210, 2);
  });

  it('honors a configured rate of exactly 0 rather than falling back to the default', async () => {
    const { agent: admin } = await superAdmin();
    const v = await currentVersion(admin);
    await admin.patch('/api/admin/settings').send({ version: v, pricing: { taxRate: 0 } }).expect(200);

    const owner = await registerAndLogin({ name: 'O', email: uniqueEmail('tax0-owner'), role: 'RESTAURANT_OWNER' });
    const customer = await registerAndLogin({ name: 'C', email: uniqueEmail('tax0-cust'), role: 'CUSTOMER' });
    const { food } = await setupOrderable(owner, { price: 100, deliveryFee: 0 });
    const cart = await customer.post('/api/cart/items').send({ foodId: food._id, quantity: 1 });

    expect(cart.body.data.cart.tax).toBe(0);
    expect(cart.body.data.cart.total).toBeCloseTo(100, 2);
  });
});

describe('M17 — pricing.service taxRate argument', () => {
  it('falls back to the platform default when no rate is passed, preserving pre-M17 behaviour', () => {
    expect(pricing.taxOn(100)).toBe(5);
    expect(pricing.computeTotals({ subtotal: 100 }).tax).toBe(5);
  });

  it('uses the rate it is given, including zero', () => {
    expect(pricing.taxOn(100, 0.2)).toBe(20);
    expect(pricing.taxOn(100, 0)).toBe(0);
    expect(pricing.computeTotals({ subtotal: 200, deliveryFee: 30, discount: 20, taxRate: 0.1 })).toEqual({
      subtotal: 200,
      deliveryFee: 30,
      discount: 20,
      tax: 20,
      total: 230,
    });
  });

  it('ignores a nonsensical rate rather than producing NaN money', () => {
    expect(pricing.taxOn(100, undefined)).toBe(5);
    expect(pricing.taxOn(100, null)).toBe(5);
    expect(pricing.taxOn(100, NaN)).toBe(5);
  });
});

describe('M17 — configurable delivery earnings and incentives', () => {
  const RATES = {
    baseEarning: 30,
    perKmRate: 10,
    minEarning: 0,
    maxEarning: null,
    incentives: {
      longDistance: { enabled: false, thresholdKm: 5, bonusAmount: 0 },
      peakHour: { enabled: false, windows: [], bonusAmount: 0 },
    },
  };
  // 12:00 UTC — deliberately outside every peak window used below unless a test
  // puts one there, so an incentive can never pass by accident of the clock.
  const NOON = new Date('2026-03-15T12:00:00.000Z');

  it('uses the configured base and per-km rates', () => {
    const calc = deliveryEarningService.calculateEarning({ deliveryDistanceKm: 4 }, RATES, NOON);
    expect(calc.baseAmount).toBe(30);
    expect(calc.distanceAmount).toBe(40);
    expect(calc.incentiveAmount).toBe(0);
    expect(calc.netAmount).toBe(70);
  });

  it('falls back to the pre-M17 defaults when called with no rates at all', () => {
    const calc = deliveryEarningService.calculateEarning({ deliveryDistanceKm: 2 });
    expect(calc.baseAmount).toBe(deliveryEarningService.BASE_EARNING);
    expect(calc.distanceAmount).toBe(deliveryEarningService.PER_KM_RATE * 2);
    expect(calc.incentiveAmount).toBe(0); // both rules ship off
  });

  it('pays the long-distance bonus only at or beyond the threshold', () => {
    const rates = { ...RATES, incentives: { ...RATES.incentives, longDistance: { enabled: true, thresholdKm: 5, bonusAmount: 25 } } };
    expect(deliveryEarningService.calculateEarning({ deliveryDistanceKm: 4.99 }, rates, NOON).incentiveAmount).toBe(0);
    expect(deliveryEarningService.calculateEarning({ deliveryDistanceKm: 5 }, rates, NOON).incentiveAmount).toBe(25); // inclusive
    expect(deliveryEarningService.calculateEarning({ deliveryDistanceKm: 12 }, rates, NOON).incentiveAmount).toBe(25); // flat, not per-km
  });

  it('pays no long-distance bonus when the order has no known distance', () => {
    const rates = { ...RATES, incentives: { ...RATES.incentives, longDistance: { enabled: true, thresholdKm: 0, bonusAmount: 25 } } };
    // thresholdKm 0 would match any number; an unknown distance must still pay
    // nothing rather than being treated as 0 km.
    const calc = deliveryEarningService.calculateEarning({ deliveryDistanceKm: null }, rates, NOON);
    expect(calc.distanceKm).toBeNull();
    expect(calc.incentiveAmount).toBe(0);
  });

  it('pays the peak-hour bonus inside a window and nothing outside it', () => {
    const rates = {
      ...RATES,
      incentives: { ...RATES.incentives, peakHour: { enabled: true, bonusAmount: 40, windows: [{ startHour: 18, endHour: 21 }] } },
    };
    const at = (iso) => deliveryEarningService.calculateEarning({ deliveryDistanceKm: 1 }, rates, new Date(iso)).incentiveAmount;
    expect(at('2026-03-15T17:59:00.000Z')).toBe(0);
    expect(at('2026-03-15T18:00:00.000Z')).toBe(40); // start is inclusive
    expect(at('2026-03-15T20:59:00.000Z')).toBe(40);
    expect(at('2026-03-15T21:00:00.000Z')).toBe(0); // end is exclusive
  });

  it('handles a window that wraps past midnight', () => {
    const rates = {
      ...RATES,
      incentives: { ...RATES.incentives, peakHour: { enabled: true, bonusAmount: 40, windows: [{ startHour: 22, endHour: 2 }] } },
    };
    const at = (iso) => deliveryEarningService.calculateEarning({ deliveryDistanceKm: 1 }, rates, new Date(iso)).incentiveAmount;
    expect(at('2026-03-15T21:59:00.000Z')).toBe(0);
    expect(at('2026-03-15T22:30:00.000Z')).toBe(40); // before midnight
    expect(at('2026-03-16T01:30:00.000Z')).toBe(40); // after midnight, same window
    expect(at('2026-03-16T02:00:00.000Z')).toBe(0);
    expect(at('2026-03-16T12:00:00.000Z')).toBe(0);
  });

  it('adds both incentives when a delivery is long AND late', () => {
    const rates = {
      ...RATES,
      incentives: {
        longDistance: { enabled: true, thresholdKm: 5, bonusAmount: 25 },
        peakHour: { enabled: true, bonusAmount: 40, windows: [{ startHour: 22, endHour: 2 }] },
      },
    };
    const calc = deliveryEarningService.calculateEarning({ deliveryDistanceKm: 8 }, rates, new Date('2026-03-15T23:00:00.000Z'));
    expect(calc.incentiveAmount).toBe(65);
    expect(calc.grossAmount).toBe(30 + 80 + 65);
  });

  it('pays nothing extra while a rule is disabled, whatever its configured bonus', () => {
    const rates = {
      ...RATES,
      incentives: {
        longDistance: { enabled: false, thresholdKm: 1, bonusAmount: 999 },
        peakHour: { enabled: false, bonusAmount: 999, windows: [{ startHour: 0, endHour: 23 }] },
      },
    };
    expect(deliveryEarningService.calculateEarning({ deliveryDistanceKm: 50 }, rates, NOON).incentiveAmount).toBe(0);
  });

  it('applies the floor and the ceiling around the incentives', () => {
    const floored = deliveryEarningService.calculateEarning({ deliveryDistanceKm: null }, { ...RATES, baseEarning: 5, minEarning: 50 }, NOON);
    expect(floored.grossAmount).toBe(5);
    expect(floored.netAmount).toBe(50);

    const capped = deliveryEarningService.calculateEarning(
      { deliveryDistanceKm: 20 },
      { ...RATES, maxEarning: 100, incentives: { ...RATES.incentives, longDistance: { enabled: true, thresholdKm: 1, bonusAmount: 500 } } },
      NOON
    );
    expect(capped.grossAmount).toBe(30 + 200 + 500);
    expect(capped.netAmount).toBe(100); // the ceiling is applied last
  });

  it('reads live settings through getDeliveryRates', async () => {
    const { agent } = await superAdmin();
    const v = await currentVersion(agent);
    await agent
      .patch('/api/admin/settings')
      .send({
        version: v,
        delivery: {
          baseEarning: 45,
          perKmRate: 12,
          incentives: { peakHour: { enabled: true, bonusAmount: 15, windows: [{ startHour: 20, endHour: 23 }] } },
        },
      })
      .expect(200);

    const rates = await platformSettingService.getDeliveryRates();
    expect(rates.baseEarning).toBe(45);
    expect(rates.perKmRate).toBe(12);
    expect(rates.incentives.peakHour.enabled).toBe(true);
    expect(rates.incentives.peakHour.windows).toEqual([{ startHour: 20, endHour: 23 }]);

    const calc = deliveryEarningService.calculateEarning({ deliveryDistanceKm: 2 }, rates, new Date('2026-03-15T21:00:00.000Z'));
    expect(calc.netAmount).toBe(45 + 24 + 15);
  });
});

describe('M17 — settings cache', () => {
  it('serves a repeat read without re-querying, then picks up a local write immediately', async () => {
    const { agent } = await superAdmin();
    await agent.get('/api/admin/settings');

    const first = await platformSettingService.getSettings();
    const second = await platformSettingService.getSettings();
    expect(second).toBe(first); // same object: served from cache, not re-read

    // A write through the service must be visible at once to the operator who
    // made it — a stale read here would show them their own change missing.
    await platformSettingService.updateSettings({ pricing: { taxRate: 0.11 } }, first.version, { actor: null });
    expect(await platformSettingService.getTaxRate()).toBe(0.11);
  });

  it('does not leave unsaved mutations in the cache after a rejected save', async () => {
    const { agent } = await superAdmin();
    const settings = await platformSettingService.getSettings();

    await expect(
      platformSettingService.updateSettings({ delivery: { minEarning: 900, maxEarning: 10 } }, settings.version, { actor: null })
    ).rejects.toThrow(/minEarning cannot be greater/i);

    // The rejected values must not be readable afterwards — the service drops the
    // cache precisely because the cached object IS the document it mutated.
    const rate = await platformSettingService.getDeliveryRates();
    expect(rate.minEarning).toBe(deliveryEarningService.MIN_EARNING);
    expect(rate.maxEarning).toBe(deliveryEarningService.MAX_EARNING);
    expect((await agent.get('/api/admin/settings')).body.data.settings.delivery.minEarning).toBe(deliveryEarningService.MIN_EARNING);
  });
});
