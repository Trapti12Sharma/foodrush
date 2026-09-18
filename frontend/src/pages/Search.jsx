import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Search as SearchIcon } from 'lucide-react';
import { restaurantService } from '../services/restaurantService';
import { foodService } from '../services/foodService';
import RestaurantCard from '../components/RestaurantCard';
import SkeletonCard from '../components/SkeletonCard';
import EmptyState from '../components/EmptyState';
import { resolveImageUrl } from '../components/ImageUploadField';

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const hasOffer = params.get('hasOffer') === 'true';
  const [inputValue, setInputValue] = useState(q);

  const [restaurants, setRestaurants] = useState([]);
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setInputValue(q);
  }, [q]);

  useEffect(() => {
    if (!q && !hasOffer) {
      setRestaurants([]);
      setFoods([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    Promise.all([
      q ? restaurantService.list({ search: q, limit: 8 }) : Promise.resolve({ restaurants: [] }),
      foodService.list({ search: q || undefined, hasOffer: hasOffer ? 'true' : undefined, limit: 20 }),
    ])
      .then(([restaurantRes, foodRes]) => {
        setRestaurants(restaurantRes.restaurants);
        setFoods(foodRes.foods);
      })
      .catch(() => {
        setRestaurants([]);
        setFoods([]);
      })
      .finally(() => setLoading(false));
  }, [q, hasOffer]);

  function submit(e) {
    e.preventDefault();
    setParams({ q: inputValue.trim() });
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

      {!loading && q && restaurants.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-lg font-bold text-gray-900">Restaurants</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {restaurants.map((r) => <RestaurantCard key={r._id} restaurant={r} />)}
          </div>
        </section>
      )}

      {!loading && foods.length > 0 && (
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
                    {food.discountPrice != null ? (
                      <>
                        ₹{food.discountPrice}{' '}
                        <span className="ml-1 text-xs font-normal text-gray-400 line-through">₹{food.price}</span>
                      </>
                    ) : (
                      `₹${food.price}`
                    )}
                  </p>
                </div>
                {food.image && <img src={resolveImageUrl(food.image)} alt={food.name} className="h-16 w-16 rounded-lg object-cover" />}
              </Link>
            ))}
          </div>
        </section>
      )}

      {!loading && (q || hasOffer) && restaurants.length === 0 && foods.length === 0 && (
        <EmptyState
          icon={SearchIcon}
          title="No results found"
          description={`Nothing matched "${q}". Try a different search term.`}
        />
      )}
    </div>
  );
}
