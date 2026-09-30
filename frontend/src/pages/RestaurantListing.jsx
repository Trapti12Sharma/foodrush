import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, UtensilsCrossed, MapPin, X } from 'lucide-react';
import { restaurantService } from '../services/restaurantService';
import { useDeliveryLocation } from '../context/LocationContext';
import RestaurantCard from '../components/RestaurantCard';
import SkeletonCard from '../components/SkeletonCard';
import EmptyState from '../components/EmptyState';

// With a chosen location the list comes from the location-aware search (distance, ETA,
// deliverability and the full filter set). Without one it falls back to the plain listing.
const NEARBY_SORTS = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'distance', label: 'Nearest' },
  { value: 'rating', label: 'Rating' },
  { value: 'deliveryTime', label: 'Delivery time' },
  { value: 'deliveryFee', label: 'Delivery fee' },
  { value: 'price', label: 'Price: low to high' },
];
const PLAIN_SORTS = [
  { value: 'rating', label: 'Rating' },
  { value: 'deliveryTime', label: 'Delivery time' },
  { value: 'deliveryFee', label: 'Delivery fee' },
  { value: 'newest', label: 'Newest' },
];

const selectClass = 'rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-brand-400';
const FILTER_KEYS = ['search', 'cuisine', 'minRating', 'maxDeliveryTime', 'maxPrice', 'veg', 'nonVeg', 'hasOffer', 'openNow'];

function Toggle({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-3 py-1 text-sm transition ${
        active ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      {children}
    </button>
  );
}

export default function RestaurantListing() {
  const [params, setParams] = useSearchParams();
  const { location, hasCoordinates, city: locationCity, openPicker } = useDeliveryLocation();

  const [restaurants, setRestaurants] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const get = (key) => params.get(key) || '';
  const search = get('search');
  const cuisine = get('cuisine');
  const minRating = get('minRating');
  const maxDeliveryTime = get('maxDeliveryTime');
  const maxPrice = get('maxPrice');
  const isOn = (key) => params.get(key) === 'true';
  const sort = get('sort') || (hasCoordinates ? 'recommended' : 'rating');
  const city = params.get('city') || locationCity || '';
  const page = Number(params.get('page') || 1);
  const paramString = params.toString();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    const q = new URLSearchParams(paramString);
    const flag = (key) => (q.get(key) === 'true' ? 'true' : undefined);

    const request = hasCoordinates
      ? restaurantService.nearby({
          lat: location.latitude,
          lng: location.longitude,
          search: q.get('search') || undefined,
          cuisine: q.get('cuisine') || undefined,
          minRating: q.get('minRating') || undefined,
          maxDeliveryTime: q.get('maxDeliveryTime') || undefined,
          maxPrice: q.get('maxPrice') || undefined,
          veg: flag('veg'),
          nonVeg: flag('nonVeg'),
          hasOffer: flag('hasOffer'),
          openNow: flag('openNow'),
          sort: q.get('sort') || 'recommended',
          page: Number(q.get('page') || 1),
          limit: 12,
        })
      : restaurantService.list({
          search: q.get('search') || undefined,
          city: q.get('city') || locationCity || undefined,
          cuisine: q.get('cuisine') || undefined,
          sort: q.get('sort') || 'rating',
          minRating: q.get('minRating') || undefined,
          page: Number(q.get('page') || 1),
          limit: 12,
        });

    request
      .then((res) => {
        if (cancelled) return;
        setRestaurants(res.restaurants);
        setPagination(res.pagination);
      })
      .catch(() => {
        if (cancelled) return;
        setRestaurants([]);
        setPagination(null);
        setFailed(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [paramString, hasCoordinates, location?.latitude, location?.longitude, locationCity]);

  function updateParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing a filter or sort restarts at page 1 — but choosing a page must keep it.
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function toggle(key) {
    updateParam(key, isOn(key) ? '' : 'true');
  }

  function clearFilters() {
    const next = new URLSearchParams(params);
    FILTER_KEYS.forEach((key) => next.delete(key));
    next.delete('page');
    setParams(next);
  }

  const hasFilters = FILTER_KEYS.some((key) => params.get(key));
  const sorts = hasCoordinates ? NEARBY_SORTS : PLAIN_SORTS;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">
          {hasCoordinates ? `Restaurants delivering to ${location.label}` : `Restaurants${city ? ` in ${city}` : ''}`}
        </h1>
        <button type="button" onClick={openPicker} className="flex items-center gap-1 text-sm font-medium text-brand-600 hover:underline">
          <MapPin size={14} /> {location ? 'Change location' : 'Set your location'}
        </button>
      </div>

      {!hasCoordinates && (
        <p className="mt-2 text-sm text-gray-500">
          Set your location to see distances, delivery estimates and filters like veg, offers and open now.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-surface p-3">
        <SlidersHorizontal size={16} className="text-gray-400" />
        <input
          key={`search-${search}`}
          defaultValue={search}
          onKeyDown={(e) => e.key === 'Enter' && updateParam('search', e.currentTarget.value)}
          onBlur={(e) => updateParam('search', e.currentTarget.value)}
          placeholder="Search restaurants or cuisine…"
          className="min-w-[10rem] flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-brand-400"
        />
        <input
          key={`cuisine-${cuisine}`}
          defaultValue={cuisine}
          onKeyDown={(e) => e.key === 'Enter' && updateParam('cuisine', e.currentTarget.value)}
          onBlur={(e) => updateParam('cuisine', e.currentTarget.value)}
          placeholder="Cuisine"
          className="w-32 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-brand-400"
        />
        <select value={minRating} onChange={(e) => updateParam('minRating', e.target.value)} className={selectClass} aria-label="Minimum rating">
          <option value="">Any rating</option>
          <option value="3.5">3.5+ stars</option>
          <option value="4">4+ stars</option>
          <option value="4.5">4.5+ stars</option>
        </select>
        <select value={sort} onChange={(e) => updateParam('sort', e.target.value)} className={selectClass} aria-label="Sort by">
          {sorts.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </select>
      </div>

      {hasCoordinates && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Toggle active={isOn('openNow')} onClick={() => toggle('openNow')}>Open now</Toggle>
          <Toggle active={isOn('hasOffer')} onClick={() => toggle('hasOffer')}>Offers</Toggle>
          <Toggle active={isOn('veg')} onClick={() => toggle('veg')}>Pure veg</Toggle>
          <Toggle active={isOn('nonVeg')} onClick={() => toggle('nonVeg')}>Serves non-veg</Toggle>
          <select value={maxDeliveryTime} onChange={(e) => updateParam('maxDeliveryTime', e.target.value)} className={selectClass} aria-label="Maximum delivery time">
            <option value="">Any delivery time</option>
            <option value="30">Under 30 min</option>
            <option value="45">Under 45 min</option>
            <option value="60">Under 60 min</option>
          </select>
          <select value={maxPrice} onChange={(e) => updateParam('maxPrice', e.target.value)} className={selectClass} aria-label="Typical price">
            <option value="">Any price</option>
            <option value="150">Around ₹150 or less</option>
            <option value="250">Around ₹250 or less</option>
            <option value="400">Around ₹400 or less</option>
          </select>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600">
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : restaurants.map((r) => <RestaurantCard key={r._id} restaurant={r} />)}
      </div>

      {!loading && restaurants.length === 0 && (
        <EmptyState
          icon={UtensilsCrossed}
          title={failed ? "Couldn't load restaurants" : hasCoordinates ? 'No restaurants match here' : 'No restaurants found'}
          description={
            failed
              ? 'Please check your connection and try again.'
              : hasCoordinates
                ? hasFilters
                  ? 'Nothing matches those filters at this location. Try clearing some.'
                  : "No partner restaurant delivers to this location yet. Try another location."
                : 'Try a different search term, city, or filter.'
          }
        />
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          {Array.from({ length: pagination.totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => updateParam('page', String(i + 1))}
              className={`h-8 w-8 rounded-full text-sm ${page === i + 1 ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
