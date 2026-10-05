import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, LocateFixed } from 'lucide-react';
import { restaurantService } from '../services/restaurantService';
import { useDeliveryLocation } from '../context/LocationContext';
import RestaurantCard from '../components/RestaurantCard';
import SkeletonCard from '../components/SkeletonCard';
import EmptyState from '../components/EmptyState';
import ScrollReveal from '../components/ScrollReveal';
import HeroFoodDecorations from '../components/food/HeroFoodDecorations';
import AnimatedFood from '../components/food/AnimatedFood';
import RotatingHeadline from '../components/home/RotatingHeadline';
import FoodCategories from '../components/home/FoodCategories';
import PromoCarousel from '../components/home/PromoCarousel';

// Renders nothing once loading finishes with no results — "Popular in X" /
// "New on FoodRush" used to show their heading plus a "No restaurants found"
// line even when empty, which just reads as a broken-looking row on a new or
// sparsely-seeded city. A row with nothing in it is not information; hiding
// it entirely is the correct empty state here (unlike "Delivering to you",
// which gets its own deliberate EmptyState below with a "Change location"
// action, because that one IS something the visitor can act on).
function RestaurantRow({ title, restaurants, loading, action }) {
  if (!loading && restaurants.length === 0) return null;
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

        <HeroFoodDecorations />

        <div className="relative z-10 mx-auto max-w-4xl px-4 py-20 text-center sm:py-24">
          <h1 className="text-4xl font-extrabold text-white sm:text-5xl">
            Craving <RotatingHeadline /> ?
            <br className="hidden sm:block" /> We&apos;ll deliver it, fast.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-gray-500">Order from the best local restaurants — or list your own on FoodRush.</p>

          <form onSubmit={submitSearch} className="mx-auto mt-6 flex max-w-xl gap-2">
            <div className="group relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-all duration-300 group-focus-within:scale-110 group-focus-within:text-brand-400"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search for restaurants or food…"
                className="w-full rounded-full border border-gray-200 bg-surface py-3 pl-10 pr-4 text-sm shadow-sm outline-none transition-all duration-300 focus:border-brand-400 focus:shadow-lg focus:shadow-brand-900/40"
              />
            </div>
            <button
              type="submit"
              className="rounded-full bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-300 hover:scale-105 hover:shadow-md hover:shadow-brand-200 active:scale-95"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      <ScrollReveal as="section" className="mx-auto max-w-7xl px-4 py-8">
        <h2 className="mb-4 text-xl font-bold text-gray-900">What&apos;s on your mind?</h2>
        <FoodCategories />
      </ScrollReveal>

      <ScrollReveal as="section" className="relative mx-auto max-w-7xl px-4">
        <AnimatedFood type="donut" size="sm" className="absolute -right-2 -top-8 hidden opacity-30 sm:block" />
        <PromoCarousel />
      </ScrollReveal>

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

      <ScrollReveal>
        <RestaurantRow
          title={city ? `Popular in ${city}` : 'Popular on FoodRush'}
          restaurants={popular}
          loading={popularLoading}
        />
      </ScrollReveal>

      <ScrollReveal className="relative">
        <AnimatedFood type="fries" size="sm" className="absolute -left-2 top-2 hidden opacity-25 lg:block" />
        <RestaurantRow title="New on FoodRush" restaurants={fresh} loading={freshLoading} />
      </ScrollReveal>
    </div>
  );
}
