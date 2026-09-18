import { useState, useCallback } from 'react';

const STORAGE_KEY = 'foodrush_city';

// A lightweight per-viewer convenience (not shared, not synced to the backend) —
// remembers the last city the visitor searched so the navbar and restaurant
// listing page can default to it.
export function useCityPreference() {
  const [city, setCityState] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const setCity = useCallback((value) => {
    setCityState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // localStorage unavailable (private mode, etc.) — city just won't persist
    }
  }, []);

  return [city, setCity];
}
