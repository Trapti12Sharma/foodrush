import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Tag, LocateFixed } from 'lucide-react';
import { restaurantService } from '../services/restaurantService';
import { useCityPreference } from '../hooks/useCityPreference';
import { FEATURED_CATEGORIES } from '../constants/cuisines';
import RestaurantCard from '../components/RestaurantCard';
import SkeletonCard from '../components/SkeletonCard';
import EmptyState from '../components/EmptyState';

function RestaurantRow({ title, restaurants, loading, emptyMessage }) {
  if (!loading && restaurants.length === 0) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <h2 className="mb-4 text-xl font-bold text-gray-900">{title}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : restaurants.map((r) => <RestaurantCard key={r._id} restaurant={r} />)}
      </div>
      {!loading && restaurants.length === 0 && <p className="text-sm text-gray-400">{emptyMessage}</p>}
    </section>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const [city, setCity] = useCityPreference();
  const [query, setQuery] = useState('');

  const [popular, setPopular] = useState([]);
  const [popularLoading, setPopularLoading] = useState(true);

  const [fresh, setFresh] = useState([]);
  const [freshLoading, setFreshLoading] = useState(true);

  const [nearby, setNearby] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [geoDenied, setGeoDenied] = useState(false);

  useEffect(() => {
    setPopularLoading(true);
    restaurantService
      .list({ sort: 'rating', limit: 8, city: city || undefined })
      .then((res) => setPopular(res.restaurants))
      .catch(() => setPopular([]))
      .finally(() => setPopularLoading(false));
  }, [city]);

  useEffect(() => {
    setFreshLoading(true);
    restaurantService
      .list({ sort: 'newest', limit: 8, city: city || undefined })
      .then((res) => setFresh(res.restaurants))
      .catch(() => setFresh([]))
      .finally(() => setFreshLoading(false));
  }, [city]);

  useEffect(() => {
    if (!navigator.geolocation) return;
    setNearbyLoading(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords;
        restaurantService
          .list({ near: `${longitude},${latitude}`, maxDistanceKm: 15, limit: 8 })
          .then((res) => setNearby(res.restaurants))
          .catch(() => setNearby([]))
          .finally(() => setNearbyLoading(false));
      },
      () => {
        setGeoDenied(true);
        setNearbyLoading(false);
      },
      { timeout: 8000 }
    );
  }, []);

  function submitSearch(e) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <div>
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center">
          <h1 className="text-3xl font-extrabold text-gray-900 sm:text-4xl">
            Food you love, delivered fast.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-gray-500">
            Order from the best local restaurants — or list your own on FoodRush.
          </p>

          <form onSubmit={submitSearch} className="mx-auto mt-8 flex max-w-xl gap-2">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for restaurants or food…"
                className="w-full rounded-full border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none focus:border-brand-400"
              />
            </div>
            <button
              type="submit"
              className="rounded-full bg-brand-600 px-6 py-3 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Search
            </button>
          </form>

          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Set your city (e.g. Pune)"
            className="mx-auto mt-3 block w-56 rounded-full border border-gray-200 bg-white px-4 py-1.5 text-center text-xs text-gray-600 outline-none focus:border-brand-400"
          />
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8">
        <h2 className="mb-4 text-xl font-bold text-gray-900">What's on your mind?</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {FEATURED_CATEGORIES.map((c) => (
            <Link
              key={c.label}
              to={`/search?q=${encodeURIComponent(c.label)}`}
              className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 bg-white p-3 text-center shadow-sm transition hover:shadow-md"
            >
              <span className="text-2xl">{c.emoji}</span>
              <span className="text-xs font-medium text-gray-700">{c.label}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4">
        <Link
          to="/search?hasOffer=true"
          className="flex items-center justify-between rounded-xl bg-brand-600 px-6 py-5 text-white shadow-sm transition hover:bg-brand-700"
        >
          <div className="flex items-center gap-3">
            <Tag size={22} />
            <div>
              <p className="font-semibold">Deals of the day</p>
              <p className="text-sm text-brand-100">Browse items with a live discount, across restaurants</p>
            </div>
          </div>
          <span className="text-sm font-medium underline">View offers</span>
        </Link>
      </section>

      <RestaurantRow
        title="Popular near you"
        restaurants={popular}
        loading={popularLoading}
        emptyMessage="No restaurants found yet — try a different city."
      />

      {(nearbyLoading || nearby.length > 0) && (
        <RestaurantRow title="Closest to your location" restaurants={nearby} loading={nearbyLoading} />
      )}
      {geoDenied && (
        <div className="mx-auto -mt-4 max-w-7xl px-4 pb-4">
          <EmptyState
            icon={LocateFixed}
            title="Location access not granted"
            description="Enable location in your browser to see restaurants closest to you."
          />
        </div>
      )}

      <RestaurantRow
        title="New on FoodRush"
        restaurants={fresh}
        loading={freshLoading}
        emptyMessage="No new restaurants yet."
      />
    </div>
  );
}
