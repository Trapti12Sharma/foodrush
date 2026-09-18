import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Star, Clock, Bike, Wallet, ArrowLeft, Heart } from 'lucide-react';
import toast from 'react-hot-toast';
import { restaurantService } from '../services/restaurantService';
import { foodService } from '../services/foodService';
import EmptyState from '../components/EmptyState';
import FoodMenuItem from '../components/FoodMenuItem';
import ConfirmDialog from '../components/ConfirmDialog';
import ReviewsSection from '../components/ReviewsSection';
import { useAddToCart } from '../hooks/useAddToCart';
import { useAuth } from '../context/AuthContext';
import { useFavorites } from '../context/FavoritesContext';

export default function RestaurantDetail() {
  const { id } = useParams();
  const [restaurant, setRestaurant] = useState(null);
  const [foods, setFoods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [menuSearch, setMenuSearch] = useState('');
  const { requestAdd, conflict, confirmSwitch, cancelSwitch } = useAddToCart();
  const { user } = useAuth();
  const { isFavorite, toggleFavorite } = useFavorites();
  const navigate = useNavigate();

  function loadRestaurant() {
    return restaurantService.getById(id).then(setRestaurant);
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([restaurantService.getById(id), foodService.list({ restaurant: id, limit: 100 })])
      .then(([r, foodRes]) => {
        setRestaurant(r);
        setFoods(foodRes.foods);
      })
      .catch((err) => setError(err.message || 'Restaurant not found'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleHeartClick() {
    if (!user) {
      toast.error('Please log in to save favorites');
      navigate('/login');
      return;
    }
    try {
      await toggleFavorite(id);
    } catch (err) {
      toast.error(err.message || 'Could not update favorites');
    }
  }

  const groupedMenu = useMemo(() => {
    const term = menuSearch.trim().toLowerCase();
    const filtered = term
      ? foods.filter((f) => f.name.toLowerCase().includes(term) || f.description?.toLowerCase().includes(term))
      : foods;

    const groups = new Map();
    filtered.forEach((food) => {
      const key = food.category?.name || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(food);
    });
    return Array.from(groups.entries());
  }, [foods, menuSearch]);

  if (loading) {
    return <div className="py-24 text-center text-gray-400">Loading restaurant…</div>;
  }

  if (error || !restaurant) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          title="Restaurant not found"
          description={error || 'This restaurant may no longer be available.'}
          action={
            <Link to="/restaurants" className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Browse other restaurants
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <div className="aspect-[3/1] w-full bg-gray-200">
        {restaurant.image && (
          <img src={restaurant.image} alt={restaurant.name} className="h-full w-full object-cover" />
        )}
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        <Link to="/restaurants" className="mb-3 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
          <ArrowLeft size={14} /> Back to restaurants
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{restaurant.name}</h1>
              <p className="mt-1 text-sm text-gray-500">{restaurant.cuisine.join(', ')} · {restaurant.city}</p>
            </div>
            <button
              type="button"
              onClick={handleHeartClick}
              aria-label={isFavorite(id) ? 'Remove from favorites' : 'Add to favorites'}
              className="mt-1 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 hover:bg-gray-50"
            >
              <Heart size={16} className={isFavorite(id) ? 'fill-red-500 text-red-500' : 'text-gray-400'} />
            </button>
          </div>
          <span className="flex items-center gap-1 rounded bg-green-600 px-2 py-1 text-sm font-medium text-white">
            <Star size={14} fill="white" /> {restaurant.totalReviews > 0 ? restaurant.rating.toFixed(1) : 'New'}
            <span className="ml-1 font-normal text-green-100">({restaurant.totalReviews} reviews)</span>
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
          <span className="flex items-center gap-1"><Clock size={16} /> {restaurant.deliveryTime} min</span>
          <span className="flex items-center gap-1">
            <Bike size={16} /> {restaurant.deliveryFee === 0 ? 'Free delivery' : `₹${restaurant.deliveryFee} delivery fee`}
          </span>
          <span className="flex items-center gap-1"><Wallet size={16} /> Min order ₹{restaurant.minimumOrder}</span>
        </div>

        {!restaurant.isOpen && (
          <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            Restaurant is currently closed. You can browse the menu, but ordering is unavailable right now.
          </div>
        )}

        <input
          value={menuSearch}
          onChange={(e) => setMenuSearch(e.target.value)}
          placeholder="Search this menu…"
          className="mt-6 w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
        />

        <div className="mt-6 space-y-8">
          {groupedMenu.length === 0 && (
            <EmptyState title="No menu items found" description="Try a different search, or check back later." />
          )}

          {groupedMenu.map(([categoryName, items]) => (
            <section key={categoryName}>
              <h2 className="mb-3 text-lg font-bold text-gray-900">{categoryName}</h2>
              <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
                {items.map((food) => (
                  <FoodMenuItem key={food._id} food={food} requestAdd={requestAdd} disabled={!restaurant.isOpen} />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-10 border-t border-gray-100 pt-8">
          <ReviewsSection restaurantId={id} onReviewChange={loadRestaurant} />
        </div>
      </div>

      <ConfirmDialog
        open={!!conflict}
        title="Start a new cart?"
        description={
          conflict
            ? `Your cart has items from ${conflict.existingRestaurantName}. Adding this item will clear it and start a new cart for ${restaurant.name}.`
            : ''
        }
        confirmLabel="Clear cart & add"
        onConfirm={confirmSwitch}
        onCancel={cancelSwitch}
      />
    </div>
  );
}
