import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, MapPin } from 'lucide-react';
import { geoService } from '../services/geoService';

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350; // one request per pause in typing, not per keystroke — each one costs Google quota

function newSessionToken() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
}

// Address search box: suggestions as you type, then resolves the chosen one to an address
// with coordinates. The same session token groups the typing and the final lookup so Google
// bills them as a single search session; a fresh one starts after each selection.
export default function PlaceSearch({ onSelect, placeholder = 'Search for your area, street or landmark', enabled = true, autoFocus = false }) {
  const [text, setText] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(newSessionToken());
  const requestRef = useRef(0); // ignores responses that arrive after a newer keystroke

  useEffect(() => {
    const query = text.trim();
    if (!enabled || query.length < MIN_CHARS) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    const timer = setTimeout(() => {
      geoService
        .autocomplete(query, sessionRef.current)
        .then((results) => {
          if (requestRef.current !== requestId) return;
          setSuggestions(results);
          setError('');
        })
        .catch((err) => {
          if (requestRef.current !== requestId) return;
          setSuggestions([]);
          setError(err.message || 'Address search is unavailable right now.');
        })
        .finally(() => {
          if (requestRef.current === requestId) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, enabled]);

  async function choose(suggestion) {
    setResolving(true);
    setError('');
    try {
      const place = await geoService.place(suggestion.placeId, sessionRef.current);
      sessionRef.current = newSessionToken(); // this search session is finished
      setText('');
      setSuggestions([]);
      onSelect(place);
    } catch (err) {
      setError(err.message || 'Could not load that place. Try another.');
    } finally {
      setResolving(false);
    }
  }

  if (!enabled) {
    return (
      <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
        Address search isn&apos;t available right now. Use your current location or pick a city instead.
      </p>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete="off"
          aria-label="Search for an address"
          aria-expanded={suggestions.length > 0}
          className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-9 text-sm outline-none focus:border-brand-500"
        />
        {(loading || resolving) && <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}
      </div>

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      {suggestions.length > 0 && (
        <ul role="listbox" className="mt-1 max-h-64 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s.placeId} role="option" aria-selected="false">
              <button
                type="button"
                disabled={resolving}
                onClick={() => choose(s)}
                className="flex w-full items-start gap-2 px-3 py-2.5 text-left hover:bg-gray-50 disabled:opacity-60"
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-gray-400" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">{s.mainText}</span>
                  {s.secondaryText && <span className="block text-xs text-gray-500">{s.secondaryText}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && text.trim().length >= MIN_CHARS && suggestions.length === 0 && (
        <p className="mt-1 text-xs text-gray-500">No matches. Try a nearby landmark or a different spelling.</p>
      )}
    </div>
  );
}
