import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Pencil, Trash2, Flag } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { reviewService } from '../services/reviewService';
import { orderService } from '../services/orderService';
import StarRating from './StarRating';
import ConfirmDialog from './ConfirmDialog';
import EmptyState from './EmptyState';

const REPORT_REASONS = [
  { value: 'SPAM', label: 'Spam' },
  { value: 'ABUSIVE', label: 'Abusive' },
  { value: 'OFFENSIVE', label: 'Offensive' },
  { value: 'FAKE', label: 'Fake / not a real experience' },
  { value: 'IRRELEVANT', label: 'Irrelevant' },
  { value: 'OTHER', label: 'Other' },
];

// M15 — shown only on the review's own author's row: their review is a normal
// public trust signal once APPROVED, but before/instead of that it needs its
// own small explanation, never a generic moderationStatus dump.
function OwnModerationNote({ review }) {
  if (review.moderationStatus === 'PENDING') {
    return <p className="mt-2 text-xs font-medium text-amber-600">Awaiting moderation — only you can see this until it's approved.</p>;
  }
  if (review.moderationStatus === 'REJECTED') {
    return (
      <p className="mt-2 text-xs font-medium text-red-600">
        Not approved{review.moderationReason ? `: ${review.moderationReason}` : ''}. Edit and resubmit for another look.
      </p>
    );
  }
  if (review.moderationStatus === 'HIDDEN') {
    return <p className="mt-2 text-xs font-medium text-gray-500">This review is currently hidden and not visible to other customers.</p>;
  }
  return null;
}

function ReviewForm({ initialValues, onSubmit, onCancel, submitting }) {
  const [rating, setRating] = useState(initialValues?.rating || 5);
  const [comment, setComment] = useState(initialValues?.comment || '');

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="mb-2 text-sm font-medium text-gray-700">Your rating</p>
      <StarRating value={rating} onChange={setRating} size={22} />
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Share your experience (optional)"
        rows={3}
        className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
        <button
          type="button"
          disabled={submitting}
          onClick={() => onSubmit({ rating, comment })}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {submitting ? 'Submitting…' : 'Submit review'}
        </button>
      </div>
    </div>
  );
}

function ReportDialog({ open, onCancel, onSubmit, submitting }) {
  const [reason, setReason] = useState('SPAM');
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
        <p className="font-semibold text-gray-900">Report this review</p>
        <p className="mt-1 text-sm text-gray-500">Your report is anonymous to other users and to the review's author.</p>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        >
          {REPORT_REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => onSubmit(reason)}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
          >
            {submitting ? 'Reporting…' : 'Report'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReviewsSection({ restaurantId, onReviewChange }) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eligibleOrders, setEligibleOrders] = useState([]);
  const [writing, setWriting] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [reportingId, setReportingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  function load() {
    setLoading(true);
    reviewService
      .listForRestaurant(restaurantId)
      .then((res) => setReviews(res.reviews))
      .catch((err) => toast.error(err.message || 'Could not load reviews'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [restaurantId]);

  useEffect(() => {
    if (!user || user.role !== 'CUSTOMER') {
      setEligibleOrders([]);
      return;
    }
    orderService
      .list({ restaurant: restaurantId, status: 'DELIVERED', limit: 50 })
      .then((res) => {
        const reviewedOrderIds = new Set(reviews.map((r) => r.order));
        setEligibleOrders(res.orders.filter((o) => !reviewedOrderIds.has(o._id)));
      })
      .catch(() => setEligibleOrders([]));
  }, [user, restaurantId, reviews]);

  async function handleCreate({ rating, comment }) {
    setSubmitting(true);
    try {
      await reviewService.create({ restaurant: restaurantId, order: eligibleOrders[0]._id, rating, comment });
      toast.success('Review submitted — it will appear once approved');
      setWriting(false);
      load();
      onReviewChange?.();
    } catch (err) {
      toast.error(err.message || 'Could not submit review');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(reviewId, { rating, comment }) {
    setSubmitting(true);
    try {
      await reviewService.update(reviewId, { rating, comment });
      toast.success('Review updated — it will be reviewed again before it counts toward the rating');
      setEditingId(null);
      load();
      onReviewChange?.();
    } catch (err) {
      toast.error(err.message || 'Could not update review');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    const id = deletingId;
    setDeletingId(null);
    try {
      await reviewService.remove(id);
      toast.success('Review deleted');
      load();
      onReviewChange?.();
    } catch (err) {
      toast.error(err.message || 'Could not delete review');
    }
  }

  async function handleReport(reason) {
    const id = reportingId;
    setSubmitting(true);
    try {
      await reviewService.report(id, reason);
      toast.success('Thanks — this review has been reported for review');
      setReportingId(null);
    } catch (err) {
      toast.error(err.message || 'Could not report this review');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Reviews</h2>
        {eligibleOrders.length > 0 && !writing && (
          <button type="button" onClick={() => setWriting(true)} className="text-sm font-medium text-brand-600 hover:underline">
            Write a review
          </button>
        )}
      </div>

      {writing && (
        <div className="mt-3">
          <ReviewForm onSubmit={handleCreate} onCancel={() => setWriting(false)} submitting={submitting} />
        </div>
      )}

      {loading ? (
        <p className="mt-4 text-sm text-gray-400">Loading reviews…</p>
      ) : reviews.length === 0 ? (
        !writing && <EmptyState title="No reviews yet" description="Be the first to review this restaurant." />
      ) : (
        <div className="mt-4 space-y-4">
          {reviews.map((review) => {
            const isMine = review.user?._id === user?._id;
            return editingId === review._id ? (
              <ReviewForm
                key={review._id}
                initialValues={review}
                onSubmit={(values) => handleUpdate(review._id, values)}
                onCancel={() => setEditingId(null)}
                submitting={submitting}
              />
            ) : (
              <div key={review._id} className="border-b border-gray-100 pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{review.user?.name || 'FoodRush user'}</p>
                    <StarRating value={review.rating} readOnly size={14} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{new Date(review.createdAt).toLocaleDateString()}</span>
                    {isMine ? (
                      <>
                        <button type="button" onClick={() => setEditingId(review._id)} className="text-gray-400 hover:text-brand-600">
                          <Pencil size={14} />
                        </button>
                        <button type="button" onClick={() => setDeletingId(review._id)} className="text-gray-400 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      </>
                    ) : (
                      user?.role === 'CUSTOMER' && (
                        <button
                          type="button"
                          onClick={() => setReportingId(review._id)}
                          className="text-gray-300 hover:text-red-500"
                          aria-label="Report this review"
                          title="Report this review"
                        >
                          <Flag size={14} />
                        </button>
                      )
                    )}
                  </div>
                </div>
                {review.comment && <p className="mt-2 text-sm text-gray-600">{review.comment}</p>}
                {isMine && <OwnModerationNote review={review} />}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deletingId}
        title="Delete this review?"
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeletingId(null)}
      />

      <ReportDialog open={!!reportingId} onCancel={() => setReportingId(null)} onSubmit={handleReport} submitting={submitting} />
    </section>
  );
}
