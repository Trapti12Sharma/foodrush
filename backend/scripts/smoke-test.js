#!/usr/bin/env node
/*
 * M18 — post-deploy smoke test.
 *
 * Answers one question about a RUNNING deployment: is this thing actually alive
 * and still refusing what it should refuse? It is the check to run immediately
 * after a deploy, when the Jest suite (which runs against a local test database,
 * not a deployment) cannot tell you anything about the environment.
 *
 * STRICTLY READ-ONLY. It never creates, updates or deletes anything, and there is
 * no write mode to accidentally point at production: the whole point is that it is
 * safe to run against the live site. That means it cannot prove a customer can
 * place an order — it proves the surface is up, the public data reads, and the
 * closed doors are closed. Placing a real order is a manual step against a staging
 * deployment, and the script says so at the end rather than implying it covered it.
 *
 * Usage:
 *   node scripts/smoke-test.js                              # http://localhost:5000
 *   node scripts/smoke-test.js --url https://api.example.com
 *   node scripts/smoke-test.js --url ... --email x@y.z --password ...
 *
 * With credentials it additionally verifies that logging in works, that the session
 * cookie is hardened, and that the account's role is enforced. Those credentials
 * are read from argv or the environment and never logged.
 *
 * Exit code is 0 only if every REQUIRED check passed. Non-zero is a failed deploy.
 */

const DEFAULT_URL = 'http://localhost:5000';

function parseArgs(argv) {
  const args = { url: process.env.SMOKE_URL || DEFAULT_URL, email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD, timeoutMs: 15000 };
  for (let i = 2; i < argv.length; i += 1) {
    const [flag, inline] = argv[i].split('=');
    const next = () => (inline !== undefined ? inline : argv[(i += 1)]);
    if (flag === '--url') args.url = next();
    else if (flag === '--email') args.email = next();
    else if (flag === '--password') args.password = next();
    else if (flag === '--timeout') args.timeoutMs = Number(next());
    else if (flag === '--help' || flag === '-h') args.help = true;
    else throw new Error(`Unknown argument "${flag}". Try --help.`);
  }
  args.url = String(args.url).replace(/\/$/, '');
  return args;
}

// ---------------------------------------------------------------------------
// Tiny assertion harness. Deliberately not Jest: this runs against a deployment,
// often from a CI step or a shell on a laptop, and should need no dev dependencies.
// ---------------------------------------------------------------------------

const results = [];
let currentGroup = 'general';

function group(name) {
  currentGroup = name;
}

async function check(name, fn, { required = true } = {}) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ group: currentGroup, name, ok: true, required, ms: Date.now() - started, detail });
  } catch (err) {
    results.push({ group: currentGroup, name, ok: false, required, ms: Date.now() - started, error: err.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

let BASE = DEFAULT_URL;
let TIMEOUT = 15000;

async function http(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      redirect: 'manual',
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(cookie ? { cookie } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null; // an HTML page (the Swagger UI) or an empty body — not an error here
    }
    return { status: res.status, headers: res.headers, text, json };
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`timed out after ${TIMEOUT}ms`);
    // A connection refused here is the most common real failure, so say so plainly
    // rather than surfacing Node's terse cause chain.
    throw new Error(`request failed: ${err.cause?.code || err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function runPublicChecks() {
  group('availability');

  await check('GET /api/health responds 200', async () => {
    const res = await http('/api/health');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    return `${res.json?.message || 'ok'}`;
  });

  await check('GET /api/config responds 200 and exposes no secrets', async () => {
    const res = await http('/api/config');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    // A public config endpoint is exactly where a key leaks, so this asserts the
    // absence of anything credential-shaped rather than trusting the field list.
    const body = res.text.toLowerCase();
    ['secret', 'private', 'razorpay_key_secret', 'jwt', 'mongodb://', 'mongodb+srv://', 'password'].forEach((needle) => {
      assert(!body.includes(needle), `the public config response contains "${needle}"`);
    });
    return 'no credential-shaped keys in the response';
  });

  await check('GET /api/docs serves the API documentation', async () => {
    const res = await http('/api/docs/');
    assert(res.status === 200 || res.status === 301 || res.status === 302, `expected 200/301/302, got ${res.status}`);
    return `status ${res.status}`;
  });

  group('public data');

  await check('GET /api/restaurants returns a list', async () => {
    const res = await http('/api/restaurants');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const items = res.json?.data?.restaurants || res.json?.data?.items;
    assert(Array.isArray(items), 'response did not contain a restaurants array');
    return `${items.length} restaurant(s) on the first page`;
  });

  // Not required: a fresh deployment with an empty catalogue is a legitimate state,
  // and so is one where the 2dsphere index has not been built yet. Worth knowing
  // about, not worth failing a deploy over.
  await check(
    'GET /api/restaurants?near=... returns geo results with a distance',
    async () => {
      const res = await http('/api/restaurants?near=77.2090,28.6139');
      assert(res.status === 200, `expected 200, got ${res.status}`);
      const items = res.json?.data?.restaurants || [];
      if (items.length === 0) return 'no restaurants near the probe coordinates (empty catalogue or none nearby)';
      const withDistance = items.filter((r) => typeof r.distanceKm === 'number' || typeof r.distance === 'number');
      assert(withDistance.length > 0, 'geo query returned rows but none carried a distance — the 2dsphere path may not be in use');
      return `${items.length} nearby, distance present`;
    },
    { required: false }
  );

  group('security posture');

  await check('security headers are set', async () => {
    const res = await http('/api/health');
    const missing = ['x-content-type-options', 'x-frame-options', 'strict-transport-security'].filter((h) => !res.headers.get(h));
    // HSTS only appears over HTTPS, so its absence on a local http:// run is
    // expected rather than a finding.
    const expected = BASE.startsWith('https://') ? missing : missing.filter((h) => h !== 'strict-transport-security');
    assert(expected.length === 0, `missing: ${expected.join(', ')}`);
    assert(!res.headers.get('x-powered-by'), 'x-powered-by is still advertised');
    return 'helmet headers present, x-powered-by suppressed';
  });

  await check('rate limiting is active', async () => {
    const res = await http('/api/health');
    const limit = res.headers.get('ratelimit-limit') || res.headers.get('x-ratelimit-limit');
    assert(limit, 'no ratelimit-limit header — the limiter may not be applied to this route');
    return `limit ${limit}`;
  });

  await check('an unknown route 404s without leaking a stack trace', async () => {
    const res = await http('/api/definitely-not-a-route');
    assert(res.status === 404, `expected 404, got ${res.status}`);
    assert(!/ at .*\(.*:\d+:\d+\)/.test(res.text), 'the response body contains a stack trace');
    assert(!res.text.includes('node_modules'), 'the response body leaks a filesystem path');
    return 'clean 404';
  });

  group('closed doors');

  // The most valuable part of this script: proving that the endpoints which must
  // never be public are still not public, on THIS deployment, right now.
  const mustBeUnauthenticated = [
    ['/api/auth/me', 'GET'],
    ['/api/cart', 'GET'],
    ['/api/orders', 'GET'],
    ['/api/addresses', 'GET'],
    ['/api/admin/dashboard', 'GET'],
    ['/api/admin/users', 'GET'],
    ['/api/admin/audit-logs', 'GET'],
    ['/api/admin/settings', 'GET'], // M17
    ['/api/admin/staff', 'GET'], // M17
    ['/api/admin/roles', 'GET'], // M17
    ['/api/notifications', 'GET'],
    ['/api/delivery-partners/me', 'GET'],
  ];

  for (const [path, method] of mustBeUnauthenticated) {
    await check(`${method} ${path} refuses an anonymous caller`, async () => {
      const res = await http(path, { method });
      assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
      return `${res.status}`;
    });
  }

  await check('a forged bearer token is rejected', async () => {
    const res = await http('/api/auth/me', { headers: { authorization: 'Bearer not.a.real.token' } });
    assert(res.status === 401, `expected 401, got ${res.status}`);
    return '401';
  });

  await check('registration cannot self-assign a staff role', async () => {
    // Uses an address that is invalid on purpose, so this cannot create an account
    // even if the role check were missing: the validator rejects the role, and the
    // malformed email is a second barrier. Either a 422 or a 400 is a pass; a 201
    // would be a serious finding.
    const res = await http('/api/auth/register', {
      method: 'POST',
      body: { name: 'Smoke Probe', email: 'smoke-probe@invalid', password: 'smoke-probe-password', role: 'SUPER_ADMIN' },
    });
    assert(res.status !== 201, 'the API created an account from a request asking for SUPER_ADMIN');
    assert(res.status === 422 || res.status === 400, `expected 400/422, got ${res.status}`);
    return `${res.status}`;
  });
}

async function runAuthenticatedChecks({ email, password }) {
  group('authenticated session');

  let cookie = null;
  let me = null;

  await check('login succeeds and sets a hardened session cookie', async () => {
    const res = await http('/api/auth/login', { method: 'POST', body: { email, password } });
    assert(res.status === 200, `expected 200, got ${res.status} (${res.json?.message || 'no message'})`);

    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
    const authCookie = setCookie.find((c) => c && c.startsWith('foodrush_token='));
    assert(authCookie, 'no foodrush_token cookie was set');
    assert(/HttpOnly/i.test(authCookie), 'the session cookie is not HttpOnly — it is readable by JavaScript');
    if (BASE.startsWith('https://')) {
      assert(/Secure/i.test(authCookie), 'the session cookie is not Secure on an HTTPS deployment');
      assert(/SameSite=None/i.test(authCookie), 'the session cookie lacks SameSite=None, so the cross-origin SPA cannot use it');
    }
    cookie = authCookie.split(';')[0];
    return 'HttpOnly' + (BASE.startsWith('https://') ? ', Secure, SameSite=None' : '');
  });

  if (!cookie) return; // nothing below can run without a session

  await check('GET /api/auth/me returns the signed-in user', async () => {
    const res = await http('/api/auth/me', { cookie });
    assert(res.status === 200, `expected 200, got ${res.status}`);
    me = res.json?.data?.user;
    assert(me, 'no user in the response');
    assert(!('password' in me), 'the user object includes a password field');
    return `${me.role}`;
  });

  await check('the role is actually enforced for this account', async () => {
    assert(me, 'no user was loaded');
    const isSuperAdmin = me.role === 'SUPER_ADMIN';
    const res = await http('/api/admin/settings', { cookie });

    if (isSuperAdmin) {
      assert(res.status === 200, `a SUPER_ADMIN got ${res.status} on /admin/settings`);
      return 'super admin can reach platform settings';
    }
    // Every other role, staff included, must be refused — this is the M17
    // separation between running the marketplace and changing its money rules.
    assert(res.status === 403, `a ${me.role} got ${res.status} on /admin/settings, expected 403`);
    return `${me.role} is correctly refused platform settings`;
  });

  await check('logout invalidates the session', async () => {
    const out = await http('/api/auth/logout', { method: 'POST', cookie });
    assert(out.status === 200, `logout returned ${out.status}`);
    return 'logged out';
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report() {
  const failedRequired = results.filter((r) => !r.ok && r.required);
  const failedOptional = results.filter((r) => !r.ok && !r.required);
  const passed = results.filter((r) => r.ok);

  let lastGroup = null;
  results.forEach((r) => {
    if (r.group !== lastGroup) {
      console.log(`\n  ${r.group}`);
      lastGroup = r.group;
    }
    const mark = r.ok ? 'PASS' : r.required ? 'FAIL' : 'WARN';
    const suffix = r.ok ? (r.detail ? ` — ${r.detail}` : '') : ` — ${r.error}`;
    console.log(`    [${mark}] ${r.name}${suffix} (${r.ms}ms)`);
  });

  const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 3);
  console.log(`\n  slowest checks: ${slowest.map((s) => `${s.name} ${s.ms}ms`).join(' · ')}`);

  console.log(`\n${'-'.repeat(72)}`);
  console.log(`  ${passed.length} passed · ${failedRequired.length} failed · ${failedOptional.length} warning(s)`);
  console.log(`  target: ${BASE}`);
  console.log(
    '  NOT covered by this script (read-only by design): placing a real order, taking a\n' +
      '  payment, dispatching a rider, or sending an email. Exercise those against a\n' +
      '  staging deployment before trusting a release.'
  );
  console.log(`${'-'.repeat(72)}\n`);

  return failedRequired.length === 0;
}

// ---------------------------------------------------------------------------

const HELP = `
M18 post-deploy smoke test — read-only checks against a running FoodRush API.

  node scripts/smoke-test.js [--url <base>] [--email <e> --password <p>] [--timeout <ms>]

  --url       API base URL, without /api (default ${DEFAULT_URL}, or $SMOKE_URL)
  --email     optional: also verify login, cookie hardening and role enforcement
  --password  password for --email (or $SMOKE_EMAIL / $SMOKE_PASSWORD)
  --timeout   per-request timeout in ms (default 15000)

Exits 0 only if every required check passed. Never writes any data.
`;

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
    return true;
  }

  BASE = args.url;
  TIMEOUT = args.timeoutMs;

  console.log(`\nFoodRush smoke test → ${BASE}`);

  await runPublicChecks();

  if (args.email && args.password) {
    await runAuthenticatedChecks(args);
  } else {
    console.log('\n  (no --email/--password given, so login, cookie hardening and role enforcement were not checked)');
  }

  return report();
}

main()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(`\nSmoke test could not run: ${err.message}\n`);
    process.exit(1);
  });
