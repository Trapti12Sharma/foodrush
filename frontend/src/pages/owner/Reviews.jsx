import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { Star, MessageSquare, Trash2, Clock, CheckCircle2, XCircle, EyeOff } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { reviewService } from '../../services/reviewService';
import StarRating from '../../components/StarRating';
import EmptyState from '../../components/EmptyState';
import ConfirmDialog from '../../components/ConfirmDialog';

const STATUS_CONFIG = {
  PENDING: { label: 'Awaiting approval', icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/10 ring-1 ring-amber-500/30' },
  APPROVED: { label: 'Approved', icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10 ring-1 ring-emerald-500/30' },
  REJECTED: { label: 'Rejected', icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-500/10 ring-1 ring-rose-500/30' },
  HIDDEN: { label: 'Hidden', icon: EyeOff, color: 'text-gray-400', bg: 'bg-white/10 ring-1 ring-white/15' },
};

function ModerationBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.PENDING;
  const Icon = cfg.icon;
  return (
    <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
      <Icon size={11} /> {cfg.label}
    </span>
  );
}

// M21 — write or edit the restaurant's public answer to one review. Kept inline
// rather than in a modal: the owner needs to read the review while writing the
// reply, and a modal would cover the thing being replied to.
function ReplyForm({ initialText, onSubmit, onCancel, submitting }) {
  const [text, setText] = useState(initialText || '');
  const trimmed = text.trim();

  return (
    <div className="mt-3 rounded-lg bg-gray-50 p-3">
      <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="reply-text">
        Your reply (public)
      </label>
      <textarea
        id="reply-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Reply as the restaurant — customers browsing your page will see this."
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-400"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-gray-400">{text.length}/1000</span>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !trimmed}
            onClick={() => onSubmit(trimmed)}
            className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Publishing…' : 'Publish reply'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Reviews() {
  const { selectedRestaurant } = useRestaurantOwner();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [removingId, setRemovingId] = useState(null);

  function load() {
    if (!selectedRestaurant) return;
    setLoading(true);
    reviewService
      .listForOwner(selectedRestaurant._id, { limit: 100 })
      .then((res) => setReviews(res.reviews))
      .catch((err) => toast.error(err.message || 'Could not load reviews'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [selectedRestaurant]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleReply(reviewId, text) {
    setSubmitting(true);
    try {
      const updated = await reviewService.reply(reviewId, text);
      // Patch the one row rather than refetching the whole list, so the page
      // does not jump back to the top mid-edit.
      setReviews((prev) => prev.map((r) => (r._id === reviewId ? { ...r, reply: updated.reply } : r)));
      setEditingId(null);
      toast.success('Reply published');
    } catch (err) {
      toast.error(err.message || 'Could not publish your reply');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove() {
    const reviewId = removingId;
    setRemovingId(null);
    try {
      await reviewService.removeReply(reviewId);
      setReviews((prev) => prev.map((r) => (r._id === reviewId ? { ...r, reply: null } : r)));
      toast.success('Reply removed');
    } catch (err) {
      toast.error(err.message || 'Could not remove the reply');
    }
  }

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
      <p className="mt-1 text-xs text-gray-400">
        Replies are public and appear under the review on your restaurant page. Only approved reviews can be replied to.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : reviews.length === 0 ? (
        <EmptyState title="No reviews yet" description="Reviews from customers will show up here." />
      ) : (
        <div className="mt-6 space-y-4">
          {reviews.map((review) => (
            <div
              key={review._id}
              className={`rounded-xl border bg-surface p-4 ${review.moderationStatus === 'PENDING'
                  ? 'border-amber-500/30'
                  : review.moderationStatus === 'REJECTED'
                    ? 'border-rose-500/30'
                    : 'border-gray-200'
                }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{review.user?.name || 'FoodRush user'}</p>
                  <StarRating value={review.rating} readOnly size={14} />
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <ModerationBadge status={review.moderationStatus} />
                  <span className="text-xs text-gray-400">{new Date(review.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              {review.comment && <p className="mt-2 text-sm text-gray-600">{review.comment}</p>}

              {/* Explain to the owner why they can't reply to non-approved reviews */}
              {review.moderationStatus === 'PENDING' && (
                <p className="mt-2 text-xs text-amber-500">
                  This review is awaiting admin approval. You can reply once it's approved.
                </p>
              )}
              {review.moderationStatus === 'REJECTED' && (
                <p className="mt-2 text-xs text-rose-400">
                  This review was rejected by an admin and is not visible to customers.
                </p>
              )}
              {review.moderationStatus === 'HIDDEN' && (
                <p className="mt-2 text-xs text-gray-400">
                  This review is currently hidden by an admin.
                </p>
              )}

              {/* Reply section — only for APPROVED reviews */}
              {review.moderationStatus === 'APPROVED' && (
                <>
                  {review.reply && editingId !== review._id && (
                    <div className="mt-3 rounded-lg border-l-2 border-brand-200 bg-brand-50/40 py-2 pl-3">
                      <p className="text-xs font-semibold text-brand-700">Your reply</p>
                      <p className="mt-1 text-sm text-gray-700">{review.reply.text}</p>
                      <div className="mt-2 flex items-center gap-3">
                        <button type="button" onClick={() => setEditingId(review._id)} className="text-xs font-medium text-brand-600 hover:underline">
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemovingId(review._id)}
                          className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-red-600"
                        >
                          <Trash2 size={12} /> Remove
                        </button>
                      </div>
                    </div>
                  )}

                  {!review.reply && editingId !== review._id && (
                    <button
                      type="button"
                      onClick={() => setEditingId(review._id)}
                      className="mt-3 flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline"
                    >
                      <MessageSquare size={14} /> Reply
                    </button>
                  )}

                  {editingId === review._id && (
                    <ReplyForm
                      initialText={review.reply?.text}
                      submitting={submitting}
                      onCancel={() => setEditingId(null)}
                      onSubmit={(text) => handleReply(review._id, text)}
                    />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!removingId}
        title="Remove your reply?"
        description="Customers will no longer see your response to this review. You can write a new one later."
        confirmLabel="Remove"
        onConfirm={handleRemove}
        onCancel={() => setRemovingId(null)}
      />
    </div>
  );
}
