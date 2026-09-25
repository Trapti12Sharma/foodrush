import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Upload, X, Image as ImageIcon } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { restaurantService } from '../../services/restaurantService';
import { optimizedUrl } from '../../utils/images';

const IMAGE_SLOTS = [
  { type: 'image', label: 'Card image' },
  { type: 'coverImage', label: 'Cover banner' },
  { type: 'logo', label: 'Logo' },
];

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
      <div className="w-full max-w-md rounded-xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
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
  const [busyId, setBusyId] = useState(null);
  const [managingImages, setManagingImages] = useState(null);

  function load() {
    setLoading(true);
    adminService
      .listRestaurants({ search: search || undefined, isApproved: approvalFilter || undefined, limit: 100 })
      .then((res) => setRestaurants(res.restaurants))
      .catch((err) => toast.error(err.message || 'Could not load restaurants'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [search, approvalFilter]);

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
            <div key={restaurant._id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
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
                  <div className="mt-1 flex gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${restaurant.isApproved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {restaurant.isApproved ? 'Approved' : 'Pending approval'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${restaurant.isActive ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {restaurant.isActive ? 'Active' : 'Disabled'}
                    </span>
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
                {!restaurant.isApproved && (
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
    </div>
  );
}
