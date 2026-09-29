import { Outlet, NavLink } from 'react-router-dom';
import toast from 'react-hot-toast';
import { LayoutDashboard, ClipboardList, UtensilsCrossed, FolderTree, Store, Star, LifeBuoy } from 'lucide-react';
import { RestaurantOwnerProvider, useRestaurantOwner } from '../context/RestaurantOwnerContext';
import { restaurantService } from '../services/restaurantService';
import CreateRestaurantForm from '../components/CreateRestaurantForm';
import NotificationBell from '../components/NotificationBell';
import { useState } from 'react';

const NAV_ITEMS = [
  { to: '/restaurant/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/restaurant/orders', label: 'Orders', icon: ClipboardList },
  { to: '/restaurant/menu', label: 'Menu', icon: UtensilsCrossed },
  { to: '/restaurant/categories', label: 'Categories', icon: FolderTree },
  { to: '/restaurant/profile', label: 'Profile', icon: Store },
  { to: '/restaurant/reviews', label: 'Reviews', icon: Star },
  { to: '/restaurant/support', label: 'Support', icon: LifeBuoy },
];

function Onboarding() {
  const { refresh } = useRestaurantOwner();
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(payload) {
    setSubmitting(true);
    try {
      await restaurantService.create(payload);
      toast.success('Restaurant created — pending admin approval');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Could not create restaurant');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">List your restaurant on FoodRush</h1>
      <p className="mb-6 text-center text-sm text-gray-500">
        Fill in your restaurant's details to get started. An admin will review and approve it before it's visible to customers.
      </p>
      <CreateRestaurantForm onSubmit={handleCreate} submitting={submitting} />
    </div>
  );
}

function Sidebar() {
  const { restaurants, selectedId, setSelectedId, selectedRestaurant } = useRestaurantOwner();

  return (
    <aside className="w-full shrink-0 rounded-xl border border-gray-200 bg-white p-4 md:w-56 md:rounded-none md:border-0 md:border-r">
      {restaurants.length > 1 ? (
        <select
          value={selectedId || ''}
          onChange={(e) => setSelectedId(e.target.value)}
          className="mb-4 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
        >
          {restaurants.map((r) => (
            <option key={r._id} value={r._id}>
              {r.name}
            </option>
          ))}
        </select>
      ) : (
        <p className="mb-4 truncate text-sm font-semibold text-gray-900">{selectedRestaurant?.name}</p>
      )}

      {selectedRestaurant && !selectedRestaurant.isApproved && (
        <p className="mb-3 rounded bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-700">Pending admin approval</p>
      )}

      <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:block md:space-y-1 md:overflow-visible md:px-0">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium md:py-2 ${
                isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
              }`
            }
          >
            <Icon size={16} /> {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

function LayoutInner() {
  const { loading, restaurants } = useRestaurantOwner();

  if (loading) return <div className="py-24 text-center text-gray-400">Loading your restaurant…</div>;
  if (restaurants.length === 0) return <Onboarding />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 md:flex-row md:gap-6">
      <Sidebar />
      <div className="flex-1">
        <div className="mb-4 flex justify-end">
          <NotificationBell />
        </div>
        <Outlet />
      </div>
    </div>
  );
}

export default function RestaurantOwnerLayout() {
  return (
    <RestaurantOwnerProvider>
      <LayoutInner />
    </RestaurantOwnerProvider>
  );
}
