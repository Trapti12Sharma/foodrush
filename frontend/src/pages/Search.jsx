import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { restaurantService } from '../services/restaurantService';
import { foodService } from '../services/foodService';
import { useDeliveryLocation } from '../context/LocationContext';
import RestaurantCard from '../components/RestaurantCard';
import SkeletonCard from '../components/SkeletonCard';
import EmptyState from '../components/EmptyState';
import SmartImage from '../components/SmartImage';

const DEBOUNCE_MS = 350;

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const hasOffer = params.get('hasOffer') === 'true';
  const page = Number(params.get('page') || 1);
  const [inputValue, setInputValue] = useState(q);
  const { location, hasCoordinates } = useDeliveryLocation();

  const [restaurants, setRestaurants] = useState([]);
  const [foods, setFoods] = useState([]);
  const [foodPagination, setFoodPagination] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // Keep the input in sync when the URL changes from elsewhere (back/forward, a shared link).
  useEffect(() => setInputValue(q), [q]);

  // Type-ahead: update the URL (debounced) as the customer types, rather than requiring Enter.
  useEffect(() => {
    const trimmed = inputValue.trim();
    if (trimmed === q) return undefined;
    const timer = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (trimmed) next.set('q', trimmed);
      else next.delete('q');
      next.delete('page');
      setParams(next, { replace: true });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputValue]);

  useEffect(() => {
    if (!q && !hasOffer) {
      setRestaurants([]);
      setFoods([]);
      setFoodPagination(null);
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setFailed(false);

    // With a chosen location, search through the location-aware endpoint so results carry
    // real distance and an ETA — the same cards used everywhere else in the app.
    const restaurantRequest = !q
      ? Promise.resolve({ restaurants: [] })
      : hasCoordinates
        ? restaurantService.nearby({ lat: location.latitude, lng: location.longitude, search: q, limit: 8 })
        : restaurantService.list({ search: q, limit: 8 });

    Promise.all([
      restaurantRequest,
      foodService.list({ search: q || undefined, hasOffer: hasOffer ? 'true' : undefined, limit: 20, page }),
    ])
      .then(([restaurantRes, foodRes]) => {
        if (cancelled) return;
        setRestaurants(restaurantRes.restaurants);
        setFoods(foodRes.foods);
        setFoodPagination(foodRes.pagination);
      })
      .catch(() => {
        if (cancelled) return;
        setRestaurants([]);
        setFoods([]);
        setFoodPagination(null);
        setFailed(true);
      })
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [q, hasOffer, page, hasCoordinates, location?.latitude, location?.longitude]);

  function submit(e) {
    e.preventDefault();
    const next = new URLSearchParams(params);
    const trimmed = inputValue.trim();
    if (trimmed) next.set('q', trimmed);
    else next.delete('q');
    next.delete('page');
    setParams(next);
  }

  function goToPage(nextPage) {
    const next = new URLSearchParams(params);
    next.set('page', String(nextPage));
    setParams(next);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <form onSubmit={submit} className="relative mb-6">
        <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Search restaurants or food…"
          autoFocus
          className="w-full rounded-full border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none focus:border-brand-400"
        />
      </form>

      {hasOffer && !q && <p className="mb-4 text-sm text-gray-500">Showing items with an active discount</p>}

      {!q && !hasOffer && (
        <EmptyState icon={SearchIcon} title="Search FoodRush" description="Find restaurants, cuisines, or dishes." />
      )}

      {loading && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      )}

      {!loading && failed && (
        <EmptyState icon={SearchIcon} title="Couldn't load results" description="Please check your connection and try again." />
      )}

      {!loading && !failed && q && restaurants.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Restaurants</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {restaurants.map((r) => <RestaurantCard key={r._id} restaurant={r} />)}
          </div>
        </section>
      )}

      {!loading && !failed && foods.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-bold text-gray-900">Dishes</h2>
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
            {foods.map((food) => (
              <Link
                key={food._id}
                to={`/restaurants/${food.restaurant}`}
                className="flex items-center justify-between gap-4 p-4 hover:bg-gray-50"
              >
                <div>
                  <p className="font-medium text-gray-900">{food.name}</p>
                  {food.description && <p className="mt-1 text-sm text-gray-500 line-clamp-1">{food.description}</p>}
                  <p className="mt-1 text-sm font-semibold text-gray-900">
                    {food.variants?.length > 0 ? (
                      `From ₹${food.displayPrice}`
                    ) : food.discountPrice != null ? (
                      <>
                        ₹{food.discountPrice}{' '}
                        <span className="ml-1 text-xs font-normal text-gray-400 line-through">₹{food.price}</span>
                      </>
                    ) : (
                      `₹${food.price}`
                    )}
                  </p>
                </div>
                <SmartImage src={food.image} alt={food.name} widths={[128, 192]} sizes="64px" className="h-16 w-16 shrink-0 rounded-lg" />
              </Link>
            ))}
          </div>

          {foodPagination && foodPagination.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-center gap-2">
              {Array.from({ length: foodPagination.totalPages }).map((_, i) => (
                <button
                  key={i}
                  onClick={() => goToPage(i + 1)}
                  className={`h-8 w-8 rounded-full text-sm ${page === i + 1 ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {!loading && !failed && (q || hasOffer) && restaurants.length === 0 && foods.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title="No results found"
          description={`Nothing matched "${q}". Try a different search term.`}
        />
      )}
    </div>
  );
}
