import { useEffect, useRef, useState } from 'react';
import toast from '@/utils/toast';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { restaurantService } from '../../services/restaurantService';
import { optimizedUrl } from '../../utils/images';

const IMAGE_SLOTS = [
  { type: 'image', label: 'Card image' },
  { type: 'coverImage', label: 'Cover banner' },
  { type: 'logo', label: 'Logo' },
];

// Kept separate from isApproved/isActive on purpose — see admin.service.js#approveRestaurant.
const KYC_STYLES = {
  NOT_SUBMITTED: 'bg-gray-100 text-gray-500',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  VERIFIED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};
const KYC_LABELS = {
  NOT_SUBMITTED: 'KYC: not submitted',
  SUBMITTED: 'KYC: awaiting review',
  VERIFIED: 'KYC: verified',
  REJECTED: 'KYC: rejected',
};

function KycBadge({ status }) {
  const s = status || 'NOT_SUBMITTED';
  return <span className={`rounded-full px-2 py-0.5 text-xs ${KYC_STYLES[s]}`}>{KYC_LABELS[s]}</span>;
}

const KYC_DOC_FIELDS = [
  { key: 'fssaiLicenseNumber', label: 'FSSAI licence number', isUrl: false },
  { key: 'fssaiCertificateUrl', label: 'FSSAI certificate', isUrl: true },
  { key: 'panNumber', label: 'PAN number', isUrl: false },
  { key: 'panCardUrl', label: 'PAN card', isUrl: true },
  { key: 'gstNumber', label: 'GST number', isUrl: false },
  { key: 'gstCertificateUrl', label: 'GST certificate', isUrl: true },
  { key: 'ownerIdentityProofUrl', label: 'Owner identity proof', isUrl: true },
];

// Review modal: shows the submitted documents and lets an admin approve (which
// atomically sets kycStatus -> VERIFIED and isApproved -> true) or reject with a
// reason (kycStatus -> REJECTED only — isApproved/isActive are never touched by
// either action outside of approve's first-time transition).
function KycReviewModal({ restaurant, onClose, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const docs = restaurant.kycDocuments || {};
  const canReview = restaurant.kycStatus === 'SUBMITTED';

  async function approve() {
    setBusy(true);
    try {
      const updated = await adminService.approveRestaurant(restaurant._id);
      toast.success('Restaurant approved and KYC verified');
      onUpdated(updated);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not approve restaurant');
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      toast.error('Please give a reason for rejecting');
      return;
    }
    setBusy(true);
    try {
      const updated = await adminService.rejectRestaurantKyc(restaurant._id, reason.trim());
      toast.success('KYC rejected');
      onUpdated(updated);
      onClose();
    } catch (err) {
      toast.error(err.message || 'Could not reject KYC');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">KYC review — {restaurant.name}</h2>
          <KycBadge status={restaurant.kycStatus} />
        </div>
        {restaurant.kycStatus === 'REJECTED' && restaurant.kycRejectionReason && (
          <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Previous rejection reason: {restaurant.kycRejectionReason}</p>
        )}

        {restaurant.kycStatus === 'NOT_SUBMITTED' ? (
          <p className="mt-4 text-sm text-gray-500">This restaurant hasn&apos;t submitted business-verification documents yet.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {KYC_DOC_FIELDS.filter(({ key }) => docs[key]).map(({ key, label, isUrl }) => (
              <div key={key}>
                <p className="mb-1 text-xs font-medium text-gray-500">{label}</p>
                {isUrl ? (
                  <a href={docs[key]} target="_blank" rel="noreferrer" className="block">
                    <img src={optimizedUrl(docs[key], { width: 320, height: 200 })} alt={label} className="h-32 w-full rounded-lg border border-gray-200 object-cover" />
                  </a>
                ) : (
                  <p className="text-sm text-gray-800">{docs[key]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {canReview && (
          <div className="mt-5 space-y-3 border-t border-gray-100 pt-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Rejection reason (only needed to reject)</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="e.g. FSSAI certificate image is unreadable"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={approve}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={reject}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        <button type="button" onClick={onClose} className="mt-6 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Close
        </button>
      </div>
    </div>
  );
}

// One upload/replace/remove control, wired directly to the dedicated
// per-image endpoints (POST/DELETE /restaurants/:id/images/:type) — each
// action persists immediately, no separate "Save" step, since an admin
// editing someone else's restaurant shouldn't have to resubmit its whole
// profile just to swap one photo.
function AdminImageSlot({ restaurant, type, label, onChanged }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const value = restaurant[type];

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const updated = await restaurantService.uploadImage(restaurant._id, type, file);
      onChanged(updated);
      toast.success(`${label} updated`);
    } catch (err) {
      toast.error(err.message || `Could not upload ${label.toLowerCase()}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    setBusy(true);
    try {
      const updated = await restaurantService.deleteImage(restaurant._id, type);
      onChanged(updated);
      toast.success(`${label} removed`);
    } catch (err) {
      toast.error(err.message || `Could not remove ${label.toLowerCase()}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="mb-1 text-xs font-medium text-gray-600">{label}</p>
      <div className="flex items-center gap-3">
        {value ? (
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-gray-200">
            <img src={optimizedUrl(value, { width: 128, height: 128 })} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              disabled={busy}
              onClick={handleRemove}
              className="absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white disabled:opacity-50"
              aria-label={`Remove ${label.toLowerCase()}`}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-gray-300 text-gray-300">
            <Upload size={20} />
          </div>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? 'Working…' : value ? 'Replace' : 'Upload'}
        </button>
        <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleFile} />
      </div>
    </div>
  );
}

function ImageManagerModal({ restaurant, onClose, onUpdated }) {
  const [current, setCurrent] = useState(restaurant);

  function handleChanged(updated) {
    setCurrent(updated);
    onUpdated(updated);
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-gray-900">Manage images — {current.name}</h2>
        <p className="mt-1 text-xs text-gray-500">Each change is saved immediately — no separate save step.</p>
        <div className="mt-4 space-y-4">
          {IMAGE_SLOTS.map(({ type, label }) => (
            <AdminImageSlot key={type} restaurant={current} type={type} label={label} onChanged={handleChanged} />
          ))}
        </div>
        <button type="button" onClick={onClose} className="mt-6 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Done
        </button>
      </div>
    </div>
  );
}

export default function Restaurants() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [kycFilter, setKycFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [managingImages, setManagingImages] = useState(null);
  const [reviewingKyc, setReviewingKyc] = useState(null);

  function load() {
    setLoading(true);
    adminService
      .listRestaurants({ search: search || undefined, isApproved: approvalFilter || undefined, kycStatus: kycFilter || undefined, limit: 100 })
      .then((res) => setRestaurants(res.restaurants))
      .catch((err) => toast.error(err.message || 'Could not load restaurants'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [search, approvalFilter, kycFilter]);

  // Only meaningful once KYC has actually been submitted — the backend rejects
  // an approve attempt otherwise (see admin.service.js#approveRestaurant), so
  // the quick one-click button is only offered in that state; anything else
  // goes through the review modal.
  async function approve(restaurant) {
    setBusyId(restaurant._id);
    try {
      await adminService.approveRestaurant(restaurant._id);
      toast.success('Restaurant approved');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not approve restaurant');
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(restaurant) {
    setBusyId(restaurant._id);
    try {
      await adminService.setRestaurantActive(restaurant._id, !restaurant.isActive);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update restaurant');
    } finally {
      setBusyId(null);
    }
  }

  // Keeps the row's thumbnail (and the modal, while open) in sync with an
  // image change, without a full reload.
  function handleImageUpdated(updated) {
    setRestaurants((prev) => prev.map((r) => (r._id === updated._id ? { ...r, ...updated } : r)));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Restaurants</h1>
        <div className="flex gap-2">
          <select
            value={approvalFilter}
            onChange={(e) => setApprovalFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">All</option>
            <option value="false">Pending approval</option>
            <option value="true">Approved</option>
          </select>
          <select
            value={kycFilter}
            onChange={(e) => setKycFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">Any KYC status</option>
            <option value="NOT_SUBMITTED">KYC: not submitted</option>
            <option value="SUBMITTED">KYC: awaiting review</option>
            <option value="VERIFIED">KYC: verified</option>
            <option value="REJECTED">KYC: rejected</option>
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="mt-6 space-y-3">
          {restaurants.map((restaurant) => (
            <div key={restaurant._id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-surface p-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-gray-100 bg-gray-50">
                  {restaurant.image ? (
                    <img src={optimizedUrl(restaurant.image, { width: 96, height: 96 })} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-gray-300">
                      <ImageIcon size={18} />
                    </div>
                  )}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{restaurant.name}</p>
                  <p className="text-xs text-gray-400">
                    {restaurant.city} · Owner: {restaurant.owner?.name} ({restaurant.owner?.email})
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${restaurant.isApproved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {restaurant.isApproved ? 'Approved' : 'Pending approval'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${restaurant.isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {restaurant.isActive ? 'Active' : 'Disabled'}
                    </span>
                    <KycBadge status={restaurant.kycStatus} />
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setManagingImages(restaurant)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Images
                </button>
                <button
                  type="button"
                  onClick={() => setReviewingKyc(restaurant)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Review KYC
                </button>
                {!restaurant.isApproved && restaurant.kycStatus === 'SUBMITTED' && (
                  <button
                    type="button"
                    disabled={busyId === restaurant._id}
                    onClick={() => approve(restaurant)}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === restaurant._id}
                  onClick={() => toggleActive(restaurant)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                >
                  {restaurant.isActive ? 'Disable' : 'Enable'}
                </button>
              </div>
            </div>
          ))}
          {restaurants.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No restaurants found.</p>}
        </div>
      )}

      {managingImages && (
        <ImageManagerModal
          restaurant={managingImages}
          onClose={() => setManagingImages(null)}
          onUpdated={(updated) => {
            handleImageUpdated(updated);
            setManagingImages(updated);
          }}
        />
      )}

      {reviewingKyc && (
        <KycReviewModal restaurant={reviewingKyc} onClose={() => setReviewingKyc(null)} onUpdated={handleImageUpdated} />
      )}
    </div>
  );
}
