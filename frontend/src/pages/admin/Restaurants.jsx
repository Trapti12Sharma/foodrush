import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

export default function Restaurants() {
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('');
  const [busyId, setBusyId] = useState(null);

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
              <div className="flex shrink-0 gap-2">
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
    </div>
  );
}
