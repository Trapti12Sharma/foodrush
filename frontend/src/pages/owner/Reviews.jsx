import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Star } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { reviewService } from '../../services/reviewService';
import StarRating from '../../components/StarRating';
import EmptyState from '../../components/EmptyState';

export default function Reviews() {
  const { selectedRestaurant } = useRestaurantOwner();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedRestaurant) return;
    setLoading(true);
    reviewService
      .listForRestaurant(selectedRestaurant._id, { limit: 100 })
      .then((res) => setReviews(res.reviews))
      .catch((err) => toast.error(err.message || 'Could not load reviews'))
      .finally(() => setLoading(false));
  }, [selectedRestaurant]);

  if (!selectedRestaurant) return null;

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>
        <span className="flex items-center gap-1 text-sm text-gray-500">
          <Star size={14} className="fill-amber-400 text-amber-400" />
          {selectedRestaurant.totalReviews > 0 ? selectedRestaurant.rating.toFixed(1) : 'New'} ({selectedRestaurant.totalReviews})
        </span>
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : reviews.length === 0 ? (
        <EmptyState title="No reviews yet" description="Reviews from customers will show up here." />
      ) : (
        <div className="mt-6 space-y-4">
          {reviews.map((review) => (
            <div key={review._id} className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">{review.user?.name || 'FoodRush user'}</p>
                <span className="text-xs text-gray-400">{new Date(review.createdAt).toLocaleDateString()}</span>
              </div>
              <StarRating value={review.rating} readOnly size={14} />
              {review.comment && <p className="mt-2 text-sm text-gray-600">{review.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
