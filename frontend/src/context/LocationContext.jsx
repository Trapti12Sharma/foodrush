import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { configService } from '../services/configService';

const STORAGE_KEY = 'foodrush_location';
const LEGACY_CITY_KEY = 'foodrush_city'; // the old free-text city box

// The customer's chosen "Deliver to" position:
// { label, area, city, state, pincode, latitude, longitude, source }
// `source` is 'gps' | 'search' | 'saved' | 'city' | 'legacy'. latitude/longitude are null
// when only a city is known (e.g. a legacy saved city, or a city with no mapped restaurants).
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const validCoords = (parsed.latitude == null && parsed.longitude == null) || (Number.isFinite(parsed.latitude) && Number.isFinite(parsed.longitude));
      if (parsed && typeof parsed.label === 'string' && validCoords) return parsed;
    }
    const legacyCity = localStorage.getItem(LEGACY_CITY_KEY);
    if (legacyCity) return { label: legacyCity, city: legacyCity, latitude: null, longitude: null, source: 'legacy' };
  } catch {
    // localStorage unavailable or corrupt — behave as "no location chosen yet"
  }
  return null;
}

function persist(location) {
  try {
    if (location) localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode etc. — the choice just won't survive a reload
  }
}

const LocationContext = createContext(null);

export function LocationProvider({ children }) {
  const [location, setLocationState] = useState(readStored);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [locationSearchEnabled, setLocationSearchEnabled] = useState(false);

  useEffect(() => {
    configService
      .get()
      .then((config) => setLocationSearchEnabled(Boolean(config.locationSearchEnabled)))
      .catch(() => setLocationSearchEnabled(false));
  }, []);

  const setLocation = useCallback((next) => {
    const normalized = {
      label: next.label || next.city || 'Selected location',
      area: next.area || '',
      city: next.city || '',
      state: next.state || '',
      pincode: next.pincode || '',
      latitude: next.latitude ?? null,
      longitude: next.longitude ?? null,
      source: next.source || 'search',
    };
    setLocationState(normalized);
    persist(normalized);
    setPickerOpen(false);
  }, []);

  const clearLocation = useCallback(() => {
    setLocationState(null);
    persist(null);
    try {
      localStorage.removeItem(LEGACY_CITY_KEY);
    } catch {
      // ignore
    }
  }, []);

  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => setPickerOpen(false), []);

  const value = useMemo(
    () => ({
      location,
      hasCoordinates: location?.latitude != null && location?.longitude != null,
      city: location?.city || '',
      setLocation,
      clearLocation,
      pickerOpen,
      openPicker,
      closePicker,
      locationSearchEnabled,
    }),
    [location, setLocation, clearLocation, pickerOpen, openPicker, closePicker, locationSearchEnabled]
  );

  return <LocationContext.Provider value={value}>{children}</LocationContext.Provider>;
}

export function useDeliveryLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useDeliveryLocation must be used within a LocationProvider');
  return ctx;
}
