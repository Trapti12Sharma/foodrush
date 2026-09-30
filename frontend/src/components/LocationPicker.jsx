import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from '@/utils/toast';
import { LocateFixed, Loader2, MapPin, X, Building2 } from 'lucide-react';
import { useDeliveryLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { addressService } from '../services/addressService';
import { geoService } from '../services/geoService';
import { restaurantService } from '../services/restaurantService';
import { getCurrentPosition, labelForPlace, LocationError } from '../utils/geolocation';
import PlaceSearch from './PlaceSearch';

// The "Deliver to" chooser. Three ways in, from most to least precise:
//   1. Use current location (browser GPS)     2. Search an address     3. A saved address
// plus a list of cities that have restaurants, which works even with no Google key.
export default function LocationPicker() {
  const { pickerOpen, closePicker, setLocation, clearLocation, location, locationSearchEnabled } = useDeliveryLocation();
  const { user } = useAuth();
  const [gpsBusy, setGpsBusy] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [addresses, setAddresses] = useState([]);
  const [cities, setCities] = useState([]);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    setGpsError('');
    restaurantService.cities().then(setCities).catch(() => setCities([]));
    if (user) addressService.list().then(setAddresses).catch(() => setAddresses([]));
    else setAddresses([]);

    const onKey = (e) => e.key === 'Escape' && closePicker();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickerOpen, user, closePicker]);

  if (!pickerOpen) return null;

  async function useCurrentLocation() {
    setGpsBusy(true);
    setGpsError('');
    try {
      const { latitude, longitude } = await getCurrentPosition();
      try {
        // Turn the coordinates into a readable address when Google is configured...
        if (!locationSearchEnabled) throw new Error('reverse geocoding unavailable');
        const place = await geoService.reverse(latitude, longitude);
        setLocation({ ...place, label: labelForPlace(place), latitude, longitude, source: 'gps' });
      } catch {
        // ...otherwise (or if that lookup fails) the coordinates alone are enough to find restaurants.
        setLocation({ label: 'Current location', latitude, longitude, source: 'gps' });
      }
    } catch (err) {
      setGpsError(err instanceof LocationError ? err.message : 'Could not get your location. Try searching instead.');
    } finally {
      setGpsBusy(false);
    }
  }

  function chooseSearched(place) {
    setLocation({ ...place, label: labelForPlace(place), source: 'search' });
  }

  function chooseSaved(address) {
    setLocation({
      label: `${address.label || 'Saved'} — ${address.addressLine}`.slice(0, 60),
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      latitude: address.latitude,
      longitude: address.longitude,
      source: 'saved',
    });
  }

  function chooseCity(city) {
    if (city.latitude == null) {
      toast('That city has no mapped restaurants yet, so distances aren’t available.', { icon: 'ℹ️' });
    }
    setLocation({ label: city.city, city: city.city, latitude: city.latitude, longitude: city.longitude, source: 'city' });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onClick={closePicker}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose your delivery location"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">Deliver to</h2>
          <button type="button" onClick={closePicker} aria-label="Close" className="rounded-full p-1 text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>
        {location && <p className="mt-1 text-xs text-gray-500">Currently: {location.label}</p>}

        <button
          type="button"
          onClick={useCurrentLocation}
          disabled={gpsBusy}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-brand-600 py-2.5 text-sm font-semibold text-brand-600 hover:bg-brand-50 disabled:opacity-60"
        >
          {gpsBusy ? <Loader2 size={16} className="animate-spin" /> : <LocateFixed size={16} />}
          {gpsBusy ? 'Finding you…' : 'Use current location'}
        </button>
        {gpsError && <p className="mt-2 text-xs text-red-600">{gpsError}</p>}

        <div className="mt-4">
          <PlaceSearch onSelect={chooseSearched} enabled={locationSearchEnabled} autoFocus={locationSearchEnabled} />
        </div>

        {user && addresses.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Saved addresses</p>
            <ul className="space-y-1.5">
              {addresses.map((a) => {
                const confirmed = a.latitude != null && a.longitude != null;
                return (
                  <li key={a._id}>
                    <button
                      type="button"
                      onClick={() => chooseSaved(a)}
                      disabled={!confirmed}
                      className="flex w-full items-start gap-2 rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <MapPin size={16} className="mt-0.5 shrink-0 text-gray-400" />
                      <span className="min-w-0 text-sm">
                        <span className="font-medium text-gray-900">{a.label || 'Address'}</span>
                        <span className="block truncate text-xs text-gray-500">{a.addressLine}, {a.city}</span>
                        {!confirmed && <span className="block text-xs text-amber-600">Location not confirmed — update it in your addresses</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <Link to="/profile/addresses" onClick={closePicker} className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
              Manage addresses
            </Link>
          </div>
        )}
        {!user && (
          <p className="mt-4 text-xs text-gray-500">
            <Link to="/login" onClick={closePicker} className="font-medium text-brand-600 hover:underline">Log in</Link> to use your saved addresses.
          </p>
        )}

        {cities.length > 0 && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Popular cities</p>
            <div className="flex flex-wrap gap-2">
              {cities.map((c) => (
                <button
                  key={c.city}
                  type="button"
                  onClick={() => chooseCity(c)}
                  className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:border-brand-400 hover:text-brand-600"
                >
                  <Building2 size={12} /> {c.city}
                  <span className="text-xs text-gray-400">({c.restaurantCount})</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {location && (
          <button
            type="button"
            onClick={() => {
              clearLocation();
              closePicker();
            }}
            className="mt-5 text-xs font-medium text-gray-500 hover:text-red-600"
          >
            Clear my location
          </button>
        )}
      </div>
    </div>
  );
}
