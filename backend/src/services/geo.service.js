const ApiError = require('../utils/ApiError');

// Google Maps Platform, called ONLY from the backend so the API key never reaches a
// browser. Uses the Places API (New) for autocomplete/details and the Geocoding API for
// reverse geocoding — both must be enabled on the key's Google Cloud project.
//
// FoodRush partner restaurants are the only things that can take orders; Google is used
// purely to turn what a customer types (or their GPS position) into an address and
// coordinates. Nothing here discovers, imports or lists external restaurants.
const PLACES_URL = 'https://places.googleapis.com/v1';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const REQUEST_TIMEOUT_MS = 5000;

function isConfigured() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY);
}

function country() {
  return String(process.env.GEO_COUNTRY || 'in').trim().toLowerCase();
}

function requireConfigured() {
  if (!isConfigured()) throw new ApiError(503, 'Location search is not configured on this server');
}

// Removes the API key from anything that might be logged (Geocoding takes the key in the URL).
function scrub(text) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  return key ? String(text).split(key).join('[key]') : String(text);
}

async function google(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    console.error('Google Maps request failed:', scrub(error.message));
    throw new ApiError(502, 'The location service is temporarily unavailable. Please try again.');
  }
  return response;
}

async function readJson(response, what) {
  try {
    return await response.json();
  } catch {
    console.error(`Google Maps ${what}: response was not JSON (HTTP ${response.status})`);
    throw new ApiError(502, 'The location service returned an unexpected response.');
  }
}

// Maps a non-2xx Places response to our own error. Google's message can echo request
// details, so only its short status word is logged and none of it is sent to the client.
function failPlaces(response, body, what) {
  const status = body?.error?.status || `HTTP ${response.status}`;
  console.error(`Google Places ${what} failed: ${status}`);
  if (response.status === 429 || status === 'RESOURCE_EXHAUSTED') {
    throw new ApiError(503, 'Location search is busy right now. Please try again in a moment.');
  }
  throw new ApiError(502, 'The location service is temporarily unavailable. Please try again.');
}

const component = (components, ...types) => components.find((c) => types.some((t) => c.types?.includes(t)));

// Places (New) address components use longText/shortText.
function fromPlacesComponents(components = []) {
  return {
    area: component(components, 'sublocality_level_1', 'sublocality', 'neighborhood')?.longText || '',
    city: component(components, 'locality', 'postal_town')?.longText || component(components, 'administrative_area_level_2')?.longText || '',
    state: component(components, 'administrative_area_level_1')?.longText || '',
    pincode: component(components, 'postal_code')?.longText || '',
  };
}

// The Geocoding API uses long_name/short_name.
function fromGeocodeComponents(components = []) {
  return {
    area: component(components, 'sublocality_level_1', 'sublocality', 'neighborhood')?.long_name || '',
    city: component(components, 'locality', 'postal_town')?.long_name || component(components, 'administrative_area_level_2')?.long_name || '',
    state: component(components, 'administrative_area_level_1')?.long_name || '',
    pincode: component(components, 'postal_code')?.long_name || '',
  };
}

// Suggestions for what the user is typing. `sessionToken` groups the keystrokes and the
// final place lookup into one billed Google session — the frontend generates it.
async function autocomplete({ input, sessionToken }) {
  requireConfigured();
  const response = await google(`${PLACES_URL}/places:autocomplete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY },
    body: JSON.stringify({ input, sessionToken, includedRegionCodes: [country()], languageCode: 'en' }),
  });
  const body = await readJson(response, 'autocomplete');
  if (!response.ok) failPlaces(response, body, 'autocomplete');

  return (body.suggestions || [])
    .filter((s) => s.placePrediction?.placeId)
    .slice(0, 6)
    .map(({ placePrediction: p }) => ({
      placeId: p.placeId,
      description: p.text?.text || '',
      mainText: p.structuredFormat?.mainText?.text || p.text?.text || '',
      secondaryText: p.structuredFormat?.secondaryText?.text || '',
    }));
}

// Resolves a chosen suggestion into an address with coordinates.
async function placeDetails({ placeId, sessionToken }) {
  requireConfigured();
  const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const response = await google(`${PLACES_URL}/places/${encodeURIComponent(placeId)}${query}`, {
    headers: {
      'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
      'X-Goog-FieldMask': 'id,displayName,formattedAddress,location,addressComponents',
    },
  });
  const body = await readJson(response, 'place details');
  if (response.status === 404) throw ApiError.notFound('That place could not be found');
  if (!response.ok) failPlaces(response, body, 'details');

  if (!body.location) throw ApiError.notFound('That place has no usable location');
  return {
    placeId: body.id || placeId,
    name: body.displayName?.text || '',
    formattedAddress: body.formattedAddress || '',
    latitude: body.location.latitude,
    longitude: body.location.longitude,
    ...fromPlacesComponents(body.addressComponents),
  };
}

// GPS position -> human-readable address.
async function reverseGeocode({ latitude, longitude }) {
  requireConfigured();
  const params = new URLSearchParams({
    latlng: `${latitude},${longitude}`,
    key: process.env.GOOGLE_MAPS_API_KEY,
    language: 'en',
  });
  const response = await google(`${GEOCODE_URL}?${params}`);
  const body = await readJson(response, 'reverse geocode');

  if (body.status === 'ZERO_RESULTS') throw ApiError.notFound('No address was found for that location');
  if (body.status === 'OVER_QUERY_LIMIT') throw new ApiError(503, 'Location search is busy right now. Please try again in a moment.');
  if (body.status !== 'OK' || !response.ok) {
    console.error(`Google Geocoding failed: ${body.status || `HTTP ${response.status}`}`);
    throw new ApiError(502, 'The location service is temporarily unavailable. Please try again.');
  }

  const [best] = body.results;
  return {
    placeId: best.place_id || null,
    formattedAddress: best.formatted_address || '',
    latitude,
    longitude,
    ...fromGeocodeComponents(best.address_components),
  };
}

module.exports = { isConfigured, autocomplete, placeDetails, reverseGeocode };
