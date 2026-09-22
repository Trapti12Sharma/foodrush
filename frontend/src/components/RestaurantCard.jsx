import { Link, useNavigate } from 'react-router-dom';
import { Star, Clock, Bike, Heart, MapPin, Leaf } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';
import SmartImage from './SmartImage';

export default function RestaurantCard({ restaurant }) {
  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const navigate = useNavigate();
  const favorited = isFavorite(restaurant._id);

  // Present only on results from the location-aware search; plain listings simply omit them.
  const hasDistance = typeof restaurant.distanceKm === 'number';
  const eta = restaurant.estimatedDeliveryMinutes ?? restaurant.deliveryTime;
  // isOpenNow (real schedule + manual pause) when present; falls back to the raw isOpen flag.
  const closed = (restaurant.isOpenNow ?? restaurant.isOpen) === false;

  async function handleHeartClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      toast.error('Please log in to save favorites');
      navigate('/login');
      return;
    }
    try {
      await toggleFavorite(restaurant._id);
    } catch (err) {
      toast.error(err.message || 'Could not update favorites');
    }
  }

  return (
    <Link
      to={`/restaurants/${restaurant._id}`}
      className="group block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="relative w-full overflow-hidden bg-gray-100">
        <SmartImage
          src={restaurant.image}
          alt={restaurant.name}
          cuisine={restaurant.cuisine}
          aspect={4 / 3}
          className={`w-full transition duration-300 group-hover:scale-105 ${closed ? 'grayscale' : ''}`}
        />
        {restaurant.hasOffer && !closed && (
          <span className="absolute left-2 top-2 rounded bg-brand-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm">
            Offers available
          </span>
        )}
        {closed && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-sm font-semibold tracking-wide text-white">
            Currently closed
          </div>
        )}
        <button
          type="button"
          onClick={handleHeartClick}
          aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 shadow-sm hover:bg-white"
        >
          <Heart size={16} className={favorited ? 'fill-red-500 text-red-500' : 'text-gray-500'} />
        </button>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 line-clamp-1">{restaurant.name}</h3>
          <span className="flex shrink-0 items-center gap-1 rounded bg-green-600 px-1.5 py-0.5 text-xs font-medium text-white">
            <Star size={12} fill="white" /> {restaurant.totalReviews > 0 ? restaurant.rating.toFixed(1) : 'New'}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-sm text-gray-500">{restaurant.cuisine?.join(', ')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span className="flex items-center gap-1" title={hasDistance ? 'Estimated delivery time' : undefined}>
            <Clock size={14} /> {hasDistance ? '~' : ''}{eta} min
          </span>
          {hasDistance && (
            <span className="flex items-center gap-1">
              <MapPin size={14} /> {restaurant.distanceKm} km
            </span>
          )}
          <span className="flex items-center gap-1">
            <Bike size={14} /> {restaurant.deliveryFee === 0 ? 'Free delivery' : `₹${restaurant.deliveryFee}`}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-gray-400">
          <span>{restaurant.city}</span>
          {restaurant.isPureVeg && (
            <span className="flex items-center gap-0.5 font-medium text-green-700">
              <Leaf size={11} /> Pure veg
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
