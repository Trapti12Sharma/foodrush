import { Link } from 'react-router-dom';
import { Star, Clock, Bike } from 'lucide-react';

export default function RestaurantCard({ restaurant }) {
  return (
    <Link
      to={`/restaurants/${restaurant._id}`}
      className="group block overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="aspect-[4/3] w-full overflow-hidden bg-gray-100">
        {restaurant.image ? (
          <img
            src={restaurant.image}
            alt={restaurant.name}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-gray-300">No image</div>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 line-clamp-1">{restaurant.name}</h3>
          <span className="flex shrink-0 items-center gap-1 rounded bg-green-600 px-1.5 py-0.5 text-xs font-medium text-white">
            <Star size={12} fill="white" /> {restaurant.totalReviews > 0 ? restaurant.rating.toFixed(1) : 'New'}
          </span>
        </div>
        <p className="mt-1 line-clamp-1 text-sm text-gray-500">{restaurant.cuisine?.join(', ')}</p>
        <div className="mt-2 flex items-center gap-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Clock size={14} /> {restaurant.deliveryTime} min
          </span>
          <span className="flex items-center gap-1">
            <Bike size={14} /> {restaurant.deliveryFee === 0 ? 'Free delivery' : `₹${restaurant.deliveryFee}`}
          </span>
        </div>
        <p className="mt-1 text-xs text-gray-400">{restaurant.city}</p>
      </div>
    </Link>
  );
}
