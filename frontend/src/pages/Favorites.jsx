import { Heart } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFavorites } from '../context/FavoritesContext';
import RestaurantCard from '../components/RestaurantCard';
import EmptyState from '../components/EmptyState';

export default function Favorites() {
  const { restaurants, loading } = useFavorites();

  if (loading) return <div className="py-24 text-center text-gray-400">Loading your favorites…</div>;

  if (restaurants.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <EmptyState
          icon={Heart}
          title="No favorites yet"
          description="Tap the heart on a restaurant to save it here."
          action={
            <Link to="/restaurants" className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Browse restaurants
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Your favorites</h1>
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {restaurants.map((r) => (
          <RestaurantCard key={r._id} restaurant={r} />
        ))}
      </div>
    </div>
  );
}
