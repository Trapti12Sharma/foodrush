import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SlidersHorizontal, UtensilsCrossed } from 'lucide-react';
import { restaurantService } from '../services/restaurantService';
import RestaurantCard from '../components/RestaurantCard';
import SkeletonCard from '../components/SkeletonCard';
import EmptyState from '../components/EmptyState';
import { useCityPreference } from '../hooks/useCityPreference';

const SORT_OPTIONS = [
  { value: 'rating', label: 'Rating' },
  { value: 'deliveryTime', label: 'Delivery time' },
  { value: 'deliveryFee', label: 'Delivery fee' },
  { value: 'newest', label: 'Newest' },
];

export default function RestaurantListing() {
  const [params, setParams] = useSearchParams();
  const [defaultCity] = useCityPreference();

  const [restaurants, setRestaurants] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [loading, setLoading] = useState(true);

  const search = params.get('search') || '';
  const city = params.get('city') || defaultCity || '';
  const cuisine = params.get('cuisine') || '';
  const sort = params.get('sort') || 'rating';
  const minRating = params.get('minRating') || '';
  const page = Number(params.get('page') || 1);

  useEffect(() => {
    setLoading(true);
    restaurantService
      .list({ search, city, cuisine, sort, minRating, page, limit: 12 })
      .then((res) => {
        setRestaurants(res.restaurants);
        setPagination(res.pagination);
      })
      .catch(() => setRestaurants([]))
      .finally(() => setLoading(false));
  }, [search, city, cuisine, sort, minRating, page]);

  function updateParam(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setParams(next);
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Restaurants{city ? ` in ${city}` : ''}</h1>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-3">
        <SlidersHorizontal size={16} className="text-gray-400" />
        <input
          defaultValue={search}
          onKeyDown={(e) => e.key === 'Enter' && updateParam('search', e.currentTarget.value)}
          onBlur={(e) => updateParam('search', e.currentTarget.value)}
          placeholder="Search restaurants or cuisine…"
          className="min-w-[10rem] flex-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-brand-400"
        />
        <input
          defaultValue={city}
          onKeyDown={(e) => e.key === 'Enter' && updateParam('city', e.currentTarget.value)}
          onBlur={(e) => updateParam('city', e.currentTarget.value)}
          placeholder="City"
          className="w-32 rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none focus:border-brand-400"
        />
        <select
          value={minRating}
          onChange={(e) => updateParam('minRating', e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none"
        >
          <option value="">Any rating</option>
          <option value="4">4+ stars</option>
          <option value="4.5">4.5+ stars</option>
        </select>
        <select
          value={sort}
          onChange={(e) => updateParam('sort', e.target.value)}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm outline-none"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              Sort: {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : restaurants.map((r) => <RestaurantCard key={r._id} restaurant={r} />)}
      </div>

      {!loading && restaurants.length === 0 && (
        <EmptyState
          icon={UtensilsCrossed}
          title="No restaurants found"
          description="Try a different search term, city, or filter."
        />
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-8 flex items-center justify-center gap-2">
          {Array.from({ length: pagination.totalPages }).map((_, i) => (
            <button
              key={i}
              onClick={() => updateParam('page', String(i + 1))}
              className={`h-8 w-8 rounded-full text-sm ${
                page === i + 1 ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
