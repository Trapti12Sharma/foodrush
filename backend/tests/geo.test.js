require('./setup');
const request = require('supertest');
const { app } = require('./helpers');

const KEY = 'test-google-key-ABC123';
const saved = { key: process.env.GOOGLE_MAPS_API_KEY, country: process.env.GEO_COUNTRY };
let fetchSpy;

beforeEach(() => {
  process.env.GOOGLE_MAPS_API_KEY = KEY;
  delete process.env.GEO_COUNTRY;
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => {
  jest.restoreAllMocks();
  if (saved.key === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = saved.key;
  if (saved.country === undefined) delete process.env.GEO_COUNTRY;
  else process.env.GEO_COUNTRY = saved.country;
});

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const SESSION = 'abcd1234-efgh-5678';

describe('when Google Maps is not configured', () => {
  it('answers 503 on every geo endpoint, and reports it on /api/config', async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    expect((await request(app).get('/api/geo/autocomplete?q=noida')).status).toBe(503);
    expect((await request(app).get('/api/geo/place/ChIJabcdefghijk')).status).toBe(503);
    expect((await request(app).get('/api/geo/reverse?lat=28.5&lng=77.3')).status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await request(app).get('/api/config')).body.data.locationSearchEnabled).toBe(false);

    process.env.GOOGLE_MAPS_API_KEY = KEY;
    expect((await request(app).get('/api/config')).body.data.locationSearchEnabled).toBe(true);
  });
});

describe('GET /api/geo/autocomplete', () => {
  const googleBody = {
    suggestions: [
      { placePrediction: { placeId: 'ChIJ_place_one_xxxx', text: { text: 'Sector 18, Noida, Uttar Pradesh, India' }, structuredFormat: { mainText: { text: 'Sector 18' }, secondaryText: { text: 'Noida, Uttar Pradesh' } } } },
      { queryPrediction: { text: { text: 'noida restaurants' } } }, // not a place: must be dropped
      { placePrediction: { placeId: 'ChIJ_place_two_xxxx', text: { text: 'Noida Sector 62' } } },
    ],
  };

  it('is public, calls Google Places (New) with the key in a header and India restriction, and maps the result', async () => {
    fetchSpy.mockResolvedValue(reply(200, googleBody));
    const res = await request(app).get(`/api/geo/autocomplete?q=%20sector%2018&sessionToken=${SESSION}`);

    expect(res.status).toBe(200);
    expect(res.body.data.suggestions).toEqual([
      { placeId: 'ChIJ_place_one_xxxx', description: 'Sector 18, Noida, Uttar Pradesh, India', mainText: 'Sector 18', secondaryText: 'Noida, Uttar Pradesh' },
      { placeId: 'ChIJ_place_two_xxxx', description: 'Noida Sector 62', mainText: 'Noida Sector 62', secondaryText: '' },
    ]);

    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:autocomplete');
    expect(options.method).toBe('POST');
    expect(options.headers['X-Goog-Api-Key']).toBe(KEY);
    expect(url).not.toContain(KEY); // never in the URL
    expect(JSON.parse(options.body)).toEqual({ input: 'sector 18', sessionToken: SESSION, includedRegionCodes: ['in'], languageCode: 'en' });
    expect(options.signal).toBeInstanceOf(AbortSignal); // has a timeout
  });

  it('respects GEO_COUNTRY', async () => {
    process.env.GEO_COUNTRY = 'AE';
    fetchSpy.mockResolvedValue(reply(200, { suggestions: [] }));
    await request(app).get('/api/geo/autocomplete?q=dubai');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).includedRegionCodes).toEqual(['ae']);
  });

  it('returns an empty list when Google has no suggestions, and caps at 6', async () => {
    fetchSpy.mockResolvedValueOnce(reply(200, {}));
    expect((await request(app).get('/api/geo/autocomplete?q=zzzzzz')).body.data.suggestions).toEqual([]);
    const many = { suggestions: Array.from({ length: 9 }, (_, i) => ({ placePrediction: { placeId: `ChIJ_place_${i}_xxxxxx`, text: { text: `P${i}` } } })) };
    fetchSpy.mockResolvedValueOnce(reply(200, many));
    expect((await request(app).get('/api/geo/autocomplete?q=many')).body.data.suggestions).toHaveLength(6);
  });

  it('validates input before spending any Google quota', async () => {
    for (const q of ['/api/geo/autocomplete', '/api/geo/autocomplete?q=ab', `/api/geo/autocomplete?q=${'x'.repeat(101)}`, '/api/geo/autocomplete?q=noida&sessionToken=bad token!', '/api/geo/autocomplete?q=noida&sessionToken=short']) {
      // eslint-disable-next-line no-await-in-loop
      expect([q, (await request(app).get(q)).status]).toEqual([q, 422]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/geo/place/:placeId', () => {
  const details = {
    id: 'ChIJ_place_one_xxxx',
    displayName: { text: 'Sector 18 Market' },
    formattedAddress: 'Sector 18, Noida, Uttar Pradesh 201301, India',
    location: { latitude: 28.5708, longitude: 77.326 },
    addressComponents: [
      { longText: 'Sector 18', types: ['sublocality_level_1', 'sublocality', 'political'] },
      { longText: 'Noida', types: ['locality', 'political'] },
      { longText: 'Uttar Pradesh', types: ['administrative_area_level_1', 'political'] },
      { longText: '201301', types: ['postal_code'] },
    ],
  };

  it('resolves a suggestion into an address with coordinates, sending the session token and a field mask', async () => {
    fetchSpy.mockResolvedValue(reply(200, details));
    const res = await request(app).get(`/api/geo/place/ChIJ_place_one_xxxx?sessionToken=${SESSION}`);

    expect(res.status).toBe(200);
    expect(res.body.data.place).toEqual({
      placeId: 'ChIJ_place_one_xxxx', name: 'Sector 18 Market', formattedAddress: 'Sector 18, Noida, Uttar Pradesh 201301, India',
      latitude: 28.5708, longitude: 77.326, area: 'Sector 18', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301',
    });
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe(`https://places.googleapis.com/v1/places/ChIJ_place_one_xxxx?sessionToken=${SESSION}`);
    expect(options.headers['X-Goog-Api-Key']).toBe(KEY);
    expect(options.headers['X-Goog-FieldMask']).toBe('id,displayName,formattedAddress,location,addressComponents');
  });

  it('falls back to the district when there is no locality, and tolerates missing components', async () => {
    fetchSpy.mockResolvedValue(reply(200, { ...details, addressComponents: [{ longText: 'Gautam Buddha Nagar', types: ['administrative_area_level_2'] }] }));
    const { place } = (await request(app).get('/api/geo/place/ChIJ_place_one_xxxx')).body.data;
    expect(place).toMatchObject({ city: 'Gautam Buddha Nagar', state: '', pincode: '', area: '' });
  });

  it('maps unknown places and places without coordinates to 404', async () => {
    fetchSpy.mockResolvedValueOnce(reply(404, { error: { status: 'NOT_FOUND' } }));
    expect((await request(app).get('/api/geo/place/ChIJ_place_one_xxxx')).status).toBe(404);
    fetchSpy.mockResolvedValueOnce(reply(200, { ...details, location: undefined }));
    expect((await request(app).get('/api/geo/place/ChIJ_place_one_xxxx')).status).toBe(404);
  });

  it('rejects malformed place ids without calling Google', async () => {
    expect((await request(app).get('/api/geo/place/short')).status).toBe(422);
    expect((await request(app).get('/api/geo/place/' + encodeURIComponent('abc/../def_ghijklmnop'))).status).not.toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('GET /api/geo/reverse', () => {
  const geocode = {
    status: 'OK',
    results: [{
      place_id: 'ChIJ_geo_xxxxxxxx',
      formatted_address: 'Sector 18, Noida, Uttar Pradesh 201301, India',
      address_components: [
        { long_name: 'Sector 18', types: ['sublocality_level_1'] },
        { long_name: 'Noida', types: ['locality'] },
        { long_name: 'Uttar Pradesh', types: ['administrative_area_level_1'] },
        { long_name: '201301', types: ['postal_code'] },
      ],
    }],
  };

  it('turns coordinates into an address', async () => {
    fetchSpy.mockResolvedValue(reply(200, geocode));
    const res = await request(app).get('/api/geo/reverse?lat=28.5708&lng=77.326');
    expect(res.status).toBe(200);
    expect(res.body.data.place).toEqual({
      placeId: 'ChIJ_geo_xxxxxxxx', formattedAddress: 'Sector 18, Noida, Uttar Pradesh 201301, India',
      latitude: 28.5708, longitude: 77.326, area: 'Sector 18', city: 'Noida', state: 'Uttar Pradesh', pincode: '201301',
    });
    const url = new URL(fetchSpy.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://maps.googleapis.com/maps/api/geocode/json');
    expect(url.searchParams.get('latlng')).toBe('28.5708,77.326');
    expect(url.searchParams.get('key')).toBe(KEY);
  });

  it('validates coordinates', async () => {
    for (const q of ['', '?lat=28.5', '?lng=77.3', '?lat=91&lng=77', '?lat=28&lng=181', '?lat=abc&lng=77']) {
      // eslint-disable-next-line no-await-in-loop
      expect([q, (await request(app).get(`/api/geo/reverse${q}`)).status]).toEqual([q, 422]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('maps Google statuses: no result -> 404, quota -> 503, denied -> 502', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(reply(200, { status: 'ZERO_RESULTS', results: [] }));
    expect((await request(app).get('/api/geo/reverse?lat=0.5&lng=0.5')).status).toBe(404);
    fetchSpy.mockResolvedValueOnce(reply(200, { status: 'OVER_QUERY_LIMIT' }));
    expect((await request(app).get('/api/geo/reverse?lat=28&lng=77')).status).toBe(503);
    fetchSpy.mockResolvedValueOnce(reply(200, { status: 'REQUEST_DENIED', error_message: `The provided API key is invalid: ${KEY}` }));
    const denied = await request(app).get('/api/geo/reverse?lat=28&lng=77');
    expect(denied.status).toBe(502);
    expect(JSON.stringify(denied.body)).not.toContain(KEY);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(errSpy.mock.calls)).toContain('REQUEST_DENIED'); // the status word is logged for diagnosis
  });
});

describe('failure handling shared by all endpoints', () => {
  it('turns a network failure into a generic 502 and scrubs the key from the log', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockRejectedValue(new Error(`connect ECONNREFUSED https://maps.googleapis.com/x?key=${KEY}`));
    const res = await request(app).get('/api/geo/reverse?lat=28&lng=77');
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/temporarily unavailable/i);
    expect(JSON.stringify(res.body)).not.toContain(KEY);
    expect(JSON.stringify(errSpy.mock.calls)).not.toContain(KEY);
    expect(JSON.stringify(errSpy.mock.calls)).toContain('[key]');
  });

  it('maps Google rate limiting to a friendly 503, other Places errors to 502, and non-JSON to 502', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    fetchSpy.mockResolvedValueOnce(reply(429, { error: { status: 'RESOURCE_EXHAUSTED', message: `quota for key ${KEY}` } }));
    const busy = await request(app).get('/api/geo/autocomplete?q=noida');
    expect(busy.status).toBe(503);
    expect(JSON.stringify(busy.body)).not.toContain(KEY);

    fetchSpy.mockResolvedValueOnce(reply(403, { error: { status: 'PERMISSION_DENIED', message: `key ${KEY} blocked` } }));
    const denied = await request(app).get('/api/geo/autocomplete?q=noida');
    expect(denied.status).toBe(502);
    expect(JSON.stringify(denied.body)).not.toContain(KEY);

    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
    expect((await request(app).get('/api/geo/autocomplete?q=noida')).status).toBe(502);
  });

  it('never includes the key in any successful response either', async () => {
    fetchSpy.mockResolvedValue(reply(200, { suggestions: [] }));
    const res = await request(app).get('/api/geo/autocomplete?q=noida');
    expect(JSON.stringify(res.body) + JSON.stringify(res.headers)).not.toContain(KEY);
  });
});
