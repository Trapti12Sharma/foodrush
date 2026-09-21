import api from './api';

// All Google Maps access goes through the FoodRush backend, which holds the API key —
// nothing here (or anywhere in the browser bundle) contains a Google key.
export const geoService = {
  autocomplete: (q, sessionToken) => api.get('/geo/autocomplete', { params: { q, sessionToken } }).then((r) => r.data.suggestions),
  place: (placeId, sessionToken) =>
    api.get(`/geo/place/${encodeURIComponent(placeId)}`, { params: { sessionToken } }).then((r) => r.data.place),
  reverse: (lat, lng) => api.get('/geo/reverse', { params: { lat, lng } }).then((r) => r.data.place),
};
