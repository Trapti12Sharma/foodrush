require('./setup');
const request = require('supertest');
const { app } = require('./helpers');
const { validateEnv } = require('../src/config/env');
const { parseOrigins, getAllowedOrigins } = require('../src/config/cors');

const GOOD_PROD = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:pw@cluster.example.mongodb.net/db',
  JWT_SECRET: 'a'.repeat(40),
  CLIENT_URL: 'https://foodrush.example.com',
};

describe('validateEnv', () => {
  it('accepts a correct production config', () => {
    expect(validateEnv(GOOD_PROD)).toEqual({ errors: [], warnings: [] });
  });

  it('requires MONGODB_URI, JWT_SECRET and a client origin in production', () => {
    const { errors } = validateEnv({ NODE_ENV: 'production' });
    expect(errors.join(' ')).toMatch(/MONGODB_URI is required/);
    expect(errors.join(' ')).toMatch(/JWT_SECRET is required/);
    expect(errors.join(' ')).toMatch(/CLIENT_URL/);
  });

  it('rejects a weak, short or placeholder JWT_SECRET in production but only warns in development', () => {
    expect(validateEnv({ ...GOOD_PROD, JWT_SECRET: 'short' }).errors.join(' ')).toMatch(/too short/);
    expect(validateEnv({ ...GOOD_PROD, JWT_SECRET: 'replace_with_a_long_random_string' }).errors.join(' ')).toMatch(/placeholder/);
    const dev = validateEnv({ ...GOOD_PROD, NODE_ENV: 'development', JWT_SECRET: 'short' });
    expect(dev.errors).toEqual([]);
    expect(dev.warnings.join(' ')).toMatch(/too short/);
  });

  it('rejects a malformed Mongo URI, JWT_EXPIRES_IN and upload size', () => {
    expect(validateEnv({ ...GOOD_PROD, MONGODB_URI: 'http://nope' }).errors.join(' ')).toMatch(/mongodb/);
    expect(validateEnv({ ...GOOD_PROD, JWT_EXPIRES_IN: 'soon' }).errors.join(' ')).toMatch(/JWT_EXPIRES_IN/);
    expect(validateEnv({ ...GOOD_PROD, MAX_UPLOAD_SIZE_MB: '-1' }).errors.join(' ')).toMatch(/MAX_UPLOAD_SIZE_MB/);
  });

  it('requires https client origins in production (localhost excepted) and rejects non-URLs', () => {
    expect(validateEnv({ ...GOOD_PROD, CLIENT_URL: 'http://foodrush.example.com' }).errors.join(' ')).toMatch(/https/);
    expect(validateEnv({ ...GOOD_PROD, CLIENT_URL: 'http://localhost:5173' }).errors).toEqual([]);
    expect(validateEnv({ ...GOOD_PROD, CLIENT_URL: 'not a url' }).errors.join(' ')).toMatch(/not a valid/);
  });

  it('never puts a secret value into a message', () => {
    const secret = 'super-secret-value-1234567890abcdefghij';
    const { errors, warnings } = validateEnv({ ...GOOD_PROD, JWT_SECRET: secret, MONGODB_URI: 'bad://user:pw@host', CLIENT_URL: 'nope' });
    expect(JSON.stringify([errors, warnings])).not.toContain(secret);
    expect(JSON.stringify([errors, warnings])).not.toContain('user:pw');
  });
});

describe('CORS allow-list', () => {
  const saved = { CLIENT_URL: process.env.CLIENT_URL, CLIENT_URLS: process.env.CLIENT_URLS };
  afterEach(() => {
    if (saved.CLIENT_URL === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = saved.CLIENT_URL;
    if (saved.CLIENT_URLS === undefined) delete process.env.CLIENT_URLS;
    else process.env.CLIENT_URLS = saved.CLIENT_URLS;
  });

  it('normalises whitespace, newlines, trailing slashes and paths down to bare origins', () => {
    expect(parseOrigins({ CLIENT_URL: '  https://a.example.com/\n' })).toEqual(['https://a.example.com']);
    expect(parseOrigins({ CLIENT_URL: 'https://a.example.com/login' })).toEqual(['https://a.example.com']);
  });

  it('merges CLIENT_URL with a comma-separated CLIENT_URLS, de-duplicated', () => {
    expect(parseOrigins({ CLIENT_URL: 'https://a.com', CLIENT_URLS: 'https://b.com, https://a.com/ ,ftp://bad,' })).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('falls back to the local dev origin only when nothing is configured', () => {
    expect(getAllowedOrigins({})).toEqual(['http://localhost:5173']);
  });

  it('echoes an allowed origin and withholds CORS headers from a disallowed one', async () => {
    process.env.CLIENT_URL = 'https://foodrush.example.com/';
    process.env.CLIENT_URLS = 'https://www.foodrush.example.com';

    const allowed = await request(app).get('/api/health').set('Origin', 'https://foodrush.example.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://foodrush.example.com');
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const second = await request(app).get('/api/health').set('Origin', 'https://www.foodrush.example.com');
    expect(second.headers['access-control-allow-origin']).toBe('https://www.foodrush.example.com');

    const denied = await request(app).get('/api/health').set('Origin', 'https://evil.example.net');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();

    const lookalike = await request(app).get('/api/health').set('Origin', 'https://foodrush.example.com.evil.net');
    expect(lookalike.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight for an allowed origin and not for a disallowed one', async () => {
    process.env.CLIENT_URL = 'https://foodrush.example.com';
    const ok = await request(app)
      .options('/api/orders')
      .set('Origin', 'https://foodrush.example.com')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.headers['access-control-allow-origin']).toBe('https://foodrush.example.com');
    const bad = await request(app).options('/api/orders').set('Origin', 'https://evil.example.net').set('Access-Control-Request-Method', 'POST');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('lets non-browser callers (no Origin header) through', async () => {
    process.env.CLIENT_URL = 'https://foodrush.example.com';
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

describe('health endpoints', () => {
  it('reports database status on /health without exposing configuration', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', db: 'connected' });
    expect(Object.keys(res.body.data).sort()).toEqual(['db', 'status', 'uptimeSeconds']);
  });

  it('keeps the original /api/health response unchanged', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'FoodRush API is running', data: null });
  });
});
