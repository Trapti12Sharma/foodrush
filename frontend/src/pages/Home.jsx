import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Tag, LocateFixed, MapPin } from 'lucide-react';
import { restaurantService } from '../services/restaurantService';
import { useDeliveryLocation } from '../context/LocationContext';
import { FEATURED_CATEGORIES } from '../constants/cuisines';
import RestaurantCard from '../components/RestaurantCard';
import SkeletonCard from '../components/SkeletonCard';
import EmptyState from '../components/EmptyState';

function RestaurantRow({ title, restaurants, loading, emptyMessage, action }) {
  if (!loading && restaurants.length === 0 && !emptyMessage) return null;
  return (
    <section className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        {action}
      </div>
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
  const { location, hasCoordinates, city, openPicker } = useDeliveryLocation();
  const [query, setQuery] = useState('');

  const [popular, setPopular] = useState([]);
  const [popularLoading, setPopularLoading] = useState(true);

  const [fresh, setFresh] = useState([]);
  const [freshLoading, setFreshLoading] = useState(true);

  const [nearby, setNearby] = useState([]);
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const [nearbyError, setNearbyError] = useState(false);

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

  // Restaurants that actually deliver to the chosen point. Runs only once the customer has
  // chosen a location — the page never asks the browser for GPS on its own.
  useEffect(() => {
    if (!hasCoordinates) {
      setNearby([]);
      setNearbyError(false);
      return undefined;
    }
    let cancelled = false;
    setNearbyLoading(true);
    setNearbyError(false);
    restaurantService
      .nearby({ lat: location.latitude, lng: location.longitude, limit: 8, sort: 'recommended' })
      .then((res) => !cancelled && setNearby(res.restaurants))
      .catch(() => {
        if (cancelled) return;
        setNearby([]);
        setNearbyError(true);
      })
      .finally(() => !cancelled && setNearbyLoading(false));
    return () => {
      cancelled = true;
    };
  }, [hasCoordinates, location?.latitude, location?.longitude]);

  function submitSearch(e) {
    e.preventDefault();
    navigate(`/search?q=${encodeURIComponent(query.trim())}`);
  }

  return (
    <div>
      <section className="relative overflow-hidden bg-gradient-to-br from-[#1a0f33] via-[#140d26] to-[#0f0b16]">
        {/* Soft decorative glow blobs — purely cosmetic, clipped by overflow-hidden above */}
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-brand-600/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -right-16 top-10 h-72 w-72 rounded-full bg-accent-500/15 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-64 w-64 rounded-full bg-brand-500/15 blur-3xl" aria-hidden="true" />

        <div className="relative mx-auto max-w-4xl px-4 py-20 text-center sm:py-24">
          <h1 className="text-4xl font-extrabold text-white sm:text-5xl">
            Food you love,{' '}
            <span className="bg-gradient-to-r from-brand-500 to-accent-400 bg-clip-text text-transparent">delivered fast.</span>
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-gray-500">Order from the best local restaurants — or list your own on FoodRush.</p>


          <button
            type="button"
            onClick={openPicker}
            className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-full border border-gray-200 bg-surface px-4 py-2.5 text-left text-sm shadow-sm transition hover:border-brand-400 hover:shadow-md"
          >
            <MapPin size={16} className="shrink-0 text-brand-600" />
            <span className="min-w-0 flex-1 truncate">
              <span className="text-gray-400">Deliver to </span>
              <span className="font-medium text-gray-900">{location?.label || 'Choose your location'}</span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-brand-600">{location ? 'Change' : 'Set'}</span>
          </button>

          <form onSubmit={submitSearch} className="mx-auto mt-3 flex max-w-xl gap-2">
            <div className="relative flex-1">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for restaurants or food…"
                className="w-full rounded-full border border-gray-200 bg-surface py-3 pl-10 pr-4 text-sm shadow-sm outline-none focus:border-brand-400"
              />
            </div>
            <button type="submit" className="rounded-full bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:shadow-md hover:shadow-brand-200">
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-8">
        <h2 className="mb-4 text-xl font-bold text-gray-900">What&apos;s on your mind?</h2>
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
          {FEATURED_CATEGORIES.map((c) => (
            <Link
              key={c.label}
              to={`/search?q=${encodeURIComponent(c.label)}`}
              className="flex flex-col items-center gap-1 rounded-xl border border-gray-100 bg-surface p-3 text-center shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-md"
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
          className="flex items-center justify-between rounded-xl bg-gradient-to-r from-brand-600 to-brand-800 px-6 py-5 text-white shadow-sm transition hover:from-brand-700 hover:to-brand-900"
        >
          <div className="flex items-center gap-3">
            <Tag size={22} />
            <div>
              <p className="font-semibold">Deals of the day</p>
              <p className="text-sm text-white/75">Browse items with a live discount, across restaurants</p>
            </div>
          </div>
          <span className="text-sm font-medium underline">View offers</span>
        </Link>
      </section>

      {hasCoordinates ? (
        <>
          <RestaurantRow
            title={`Delivering to ${location.label}`}
            restaurants={nearby}
            loading={nearbyLoading}
            action={
              <Link to="/restaurants" className="text-sm font-medium text-brand-600 hover:underline">
                See all &amp; filter
              </Link>
            }
          />
          {!nearbyLoading && nearby.length === 0 && (
            <div className="mx-auto -mt-4 max-w-7xl px-4 pb-4">
              <EmptyState
                icon={LocateFixed}
                title={nearbyError ? "Couldn't load restaurants near you" : 'No restaurants deliver here yet'}
                description={
                  nearbyError
                    ? 'Please check your connection and try again.'
                    : "We don't have a partner restaurant that delivers to this location yet. Try another location."
                }
              />
              <div className="mt-3 text-center">
                <button type="button" onClick={openPicker} className="text-sm font-semibold text-brand-600 hover:underline">
                  Change location
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <section className="mx-auto max-w-7xl px-4 py-8">
          <div className="flex flex-col items-start justify-between gap-3 rounded-xl border border-dashed border-brand-300 bg-brand-50 p-5 sm:flex-row sm:items-center">
            <div>
              <p className="font-semibold text-gray-900">See what&apos;s delivered near you</p>
              <p className="text-sm text-gray-600">Choose your location for distances, delivery estimates and filters.</p>
            </div>
            <button type="button" onClick={openPicker} className="rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Choose location
            </button>
          </div>
        </section>
      )}

      <RestaurantRow
        title={city ? `Popular in ${city}` : 'Popular on FoodRush'}
        restaurants={popular}
        loading={popularLoading}
        emptyMessage="No restaurants found yet — try a different location."
      />

      <RestaurantRow title="New on FoodRush" restaurants={fresh} loading={freshLoading} emptyMessage="No new restaurants yet." />
    </div>
  );
}
