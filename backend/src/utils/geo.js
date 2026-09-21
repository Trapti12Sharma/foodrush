// Pure geometry/validation helpers — no I/O.

const DEFAULT_DELIVERY_RADIUS_KM = 5;
const MAX_SEARCH_RADIUS_KM = 50;

// Rough delivery-time model until real routing (Google Routes / rider ETA) lands with
// the delivery milestone: the restaurant's own preparation+base time, plus travel at
// about 20 km/h city speed (3 minutes per km). It is an ESTIMATE and is labelled so in
// the API and the UI.
const MINUTES_PER_KM = 3;

const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

function isValidLatitude(lat) {
  return isFiniteNumber(lat) && lat >= -90 && lat <= 90;
}

function isValidLongitude(lng) {
  return isFiniteNumber(lng) && lng >= -180 && lng <= 180;
}

// GeoJSON order is [longitude, latitude]. Exactly [0, 0] ("Null Island", in the Atlantic)
// is what an unset location used to default to, so it is treated as "no location".
function isValidPointCoordinates(coordinates) {
  return (
    Array.isArray(coordinates) &&
    coordinates.length === 2 &&
    isValidLongitude(coordinates[0]) &&
    isValidLatitude(coordinates[1]) &&
    !(coordinates[0] === 0 && coordinates[1] === 0)
  );
}

// Great-circle distance in kilometres (haversine).
function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}

const roundTo = (n, decimals = 1) => Math.round(n * 10 ** decimals) / 10 ** decimals;

module.exports = {
  DEFAULT_DELIVERY_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
  MINUTES_PER_KM,
  isValidLatitude,
  isValidLongitude,
  isValidPointCoordinates,
  haversineKm,
  roundTo,
};
