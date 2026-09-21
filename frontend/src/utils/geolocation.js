// Wraps the browser Geolocation API in a promise with typed, user-friendly failures.
// Nothing is requested until a user clicks something — we never prompt on page load.

export class LocationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code; // 'unsupported' | 'denied' | 'unavailable' | 'timeout'
  }
}

const MESSAGES = {
  unsupported: "Your browser doesn't support location. Search for your address instead.",
  denied: 'Location access is blocked. Allow it in your browser settings, or search for your address instead.',
  unavailable: "We couldn't work out where you are. Check your device's location setting, or search for your address.",
  timeout: 'Finding your location took too long. Try again, or search for your address instead.',
};

export function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new LocationError('unsupported', MESSAGES.unsupported));
    return navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude, accuracyMeters: coords.accuracy }),
      (error) => {
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        const code = error.code === 1 ? 'denied' : error.code === 3 ? 'timeout' : 'unavailable';
        reject(new LocationError(code, MESSAGES[code]));
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
    );
  });
}

// "Sector 18, Noida, Uttar Pradesh 201301, India" -> without the trailing country, ready to
// prefill an editable address field.
export function tidyAddress(formattedAddress = '') {
  const parts = formattedAddress.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 1 && /^(india|united arab emirates|united kingdom|united states)$/i.test(parts[parts.length - 1])) parts.pop();
  return parts.join(', ');
}

// A short label for the navbar/picker from a place returned by the backend.
export function labelForPlace(place) {
  if (place.area && place.city) return `${place.area}, ${place.city}`;
  if (place.name && place.city) return `${place.name}, ${place.city}`;
  if (place.city) return place.city;
  return (place.formattedAddress || 'Selected location').split(',').slice(0, 2).join(',').trim();
}
