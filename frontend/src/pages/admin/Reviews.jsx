import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { Flag } from 'lucide-react';
import { adminService } from '../../services/adminService';
import StarRating from '../../components/StarRating';
import Pagination from '../../components/Pagination';

const PAGE_SIZE = 10;

const STATUS_OPTIONS = ['PENDING', 'APPROVED', 'REJECTED', 'HIDDEN'];
const STATUS_STYLES = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  HIDDEN: 'bg-gray-200 text-gray-600',
};

function Badge({ value }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[value] || 'bg-gray-100 text-gray-500'}`}>{value}</span>;
}

// M15 — approve/reject only apply from PENDING, hide only from APPROVED,
// restore only from HIDDEN (see backend/src/services/review.service.js) —
// mirrored here so the UI never offers an action the server will reject.
function ReviewDetailModal({ reviewId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    adminService
      .getReview(reviewId)
      .then(setData)
      .catch((err) => toast.error(err.message || 'Could not load review'));
  }

  useEffect(load, [reviewId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action) {
    setBusy(true);
    try {
      await action();
      setReason('');
      load();
      onChanged();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!data) return null;
  const { review, reports } = data;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400">{review.restaurant?.name} · order #{review.order?.orderNumber}</p>
            <p className="font-semibold text-gray-900">{review.user?.name} <span className="font-normal text-gray-400">({review.user?.email})</span></p>
          </div>
          <Badge value={review.moderationStatus} />
        </div>

        <div className="mt-3">
          <StarRating value={review.rating} readOnly size={16} />
          {review.comment && <p className="mt-2 text-sm text-gray-700">{review.comment}</p>}
          {review.images?.length > 0 && (
            <div className="mt-2 flex gap-2">
              {review.images.map((src) => (
                <img key={src} src={src} alt="" className="h-16 w-16 rounded-lg border border-gray-200 object-cover" />
              ))}
            </div>
          )}
        </div>

        {review.moderationReason && (
          <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">Moderation note: {review.moderationReason}</p>
        )}
        {review.moderatedBy && (
          <p className="mt-1 text-xs text-gray-400">
            Last moderated by {review.moderatedBy.name} on {new Date(review.moderatedAt).toLocaleString()}
          </p>
        )}

        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <Flag size={14} /> {review.reportCount || 0} report{review.reportCount === 1 ? '' : 's'}
          </p>
          {reports.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-gray-500">
              {reports.map((r) => (
                <li key={r._id}>
                  {r.reason} — {new Date(r.createdAt).toLocaleString()}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-gray-400">Reporter identity is never shown, by design.</p>
        </div>

        <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
          {(review.moderationStatus === 'PENDING' || review.moderationStatus === 'APPROVED') && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                Reason {review.moderationStatus === 'PENDING' ? '(required to reject)' : '(optional, to hide)'}
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="e.g. Contains abusive language"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {review.moderationStatus === 'PENDING' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => adminService.approveReview(review._id))}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy || !reason.trim()}
                  onClick={() => run(() => adminService.rejectReview(review._id, reason.trim()))}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              </>
            )}
            {review.moderationStatus === 'APPROVED' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => adminService.hideReview(review._id, reason.trim() || undefined))}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Hide
              </button>
            )}
            {review.moderationStatus === 'HIDDEN' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => adminService.restoreReview(review._id))}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Restore
              </button>
            )}
          </div>
        </div>

        <button type="button" onClick={onClose} className="mt-6 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Close
        </button>
      </div>
    </div>
  );
}

export default function Reviews() {
  const [reviews, setReviews] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ moderationStatus: '', reported: '', search: '' });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  function load() {
    setLoading(true);
    const params = { page, limit: PAGE_SIZE };
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params[k] = v;
    });
    adminService
      .listReviews(params)
      .then((res) => {
        setReviews(res.reviews);
        setPagination(res.pagination);
      })
      .catch((err) => toast.error(err.message || 'Could not load reviews'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters(e) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function quickApprove(id) {
    setBusyId(id);
    try {
      await adminService.approveReview(id);
      toast.success('Review approved');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not approve review');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject() {
    const id = rejectingId;
    if (!rejectReason.trim()) {
      toast.error('A reason is required to reject');
      return;
    }
    setBusyId(id);
    setRejectingId(null);
    try {
      await adminService.rejectReview(id, rejectReason.trim());
      toast.success('Review rejected');
      setRejectReason('');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not reject review');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Reviews</h1>

      <form onSubmit={applyFilters} className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-surface p-4 sm:grid-cols-4">
        <select
          value={filters.moderationStatus}
          onChange={(e) => setFilters((f) => ({ ...f, moderationStatus: e.target.value }))}
          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          value={filters.reported}
          onChange={(e) => setFilters((f) => ({ ...f, reported: e.target.value }))}
          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">All reviews</option>
          <option value="true">Reported only</option>
        </select>
        <input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Review text or customer"
          className="col-span-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm sm:col-span-1"
        />
        <button type="submit" className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
          Filter
        </button>
      </form>

      {loading ? (
        <p className="mt-4 text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-brand-300/20 shadow-xl shadow-black/30">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Restaurant</th>
                  <th>Customer</th>
                  <th>Rating</th>
                  <th>Comment</th>
                  <th>Status</th>
                  <th>Reports</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => (
                  <tr key={r._id}>
                    <td className="font-medium text-gray-900">{r.restaurant?.name}</td>
                    <td>{r.user?.name}</td>
                    <td><StarRating value={r.rating} readOnly size={12} /></td>
                    <td className="max-w-xs truncate">{r.comment || '—'}</td>
                    <td><Badge value={r.moderationStatus} /></td>
                    <td>{r.reportCount > 0 ? <span className="font-bold text-rose-400">{r.reportCount}</span> : '—'}</td>
                    <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td>
                      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        {r.moderationStatus === 'PENDING' && (
                          <>
                            <button
                              type="button"
                              disabled={busyId === r._id}
                              onClick={() => quickApprove(r._id)}
                              className="table-action-btn-success"
                            >
                              ✓ Approve
                            </button>
                            <button
                              type="button"
                              disabled={busyId === r._id}
                              onClick={() => { setRejectingId(r._id); setRejectReason(''); }}
                              className="table-action-btn-danger"
                            >
                              ✕ Reject
                            </button>
                          </>
                        )}
                        {r.moderationStatus === 'APPROVED' && (
                          <button
                            type="button"
                            disabled={busyId === r._id}
                            onClick={async () => {
                              setBusyId(r._id);
                              try { await adminService.hideReview(r._id); toast.success('Review hidden'); load(); }
                              catch (err) { toast.error(err.message || 'Could not hide review'); }
                              finally { setBusyId(null); }
                            }}
                            className="table-action-btn-danger"
                          >
                            Hide
                          </button>
                        )}
                        {r.moderationStatus === 'HIDDEN' && (
                          <button
                            type="button"
                            disabled={busyId === r._id}
                            onClick={async () => {
                              setBusyId(r._id);
                              try { await adminService.restoreReview(r._id); toast.success('Review restored'); load(); }
                              catch (err) { toast.error(err.message || 'Could not restore review'); }
                              finally { setBusyId(null); }
                            }}
                            className="table-action-btn-success"
                          >
                            Restore
                          </button>
                        )}
                        <button type="button" onClick={() => setOpenId(r._id)} className="table-action-btn">
                          Details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {reviews.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No reviews found.</p>}
          <Pagination meta={pagination} onPageChange={setPage} />
        </div>
      )}

      {/* Reject reason dialog */}
      {rejectingId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-surface p-5 shadow-2xl">
            <h2 className="text-sm font-semibold text-gray-900">Reject this review</h2>
            <p className="mt-1 text-xs text-gray-400">A reason is required and will be shown to the customer.</p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="e.g. Contains abusive language"
              className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              autoFocus
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setRejectingId(null); setRejectReason(''); }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim()}
                onClick={confirmReject}
                className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {openId && <ReviewDetailModal reviewId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
