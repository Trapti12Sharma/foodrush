import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import toast from 'react-hot-toast';
import { LayoutDashboard, UserRound, LifeBuoy } from 'lucide-react';
import { DeliveryPartnerProvider, useDeliveryPartner } from '../context/DeliveryPartnerContext';
import { deliveryPartnerService } from '../services/deliveryPartnerService';
import CreateDeliveryPartnerForm from '../components/CreateDeliveryPartnerForm';
import NotificationBell from '../components/NotificationBell';

const NAV_ITEMS = [
  { to: '/delivery/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/delivery/profile', label: 'Profile', icon: UserRound },
  { to: '/delivery/support', label: 'Support', icon: LifeBuoy },
];

function Onboarding() {
  const { refresh } = useDeliveryPartner();
  const [submitting, setSubmitting] = useState(false);

  async function handleCreate(payload) {
    setSubmitting(true);
    try {
      await deliveryPartnerService.create(payload);
      toast.success('Submitted — an admin will review your documents shortly');
      await refresh();
    } catch (err) {
      toast.error(err.message || 'Could not submit your profile');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="mb-2 text-center text-2xl font-bold text-gray-900">Deliver for FoodRush</h1>
      <p className="mb-6 text-center text-sm text-gray-500">
        Tell us about yourself and your vehicle, and upload your documents. An admin will review your KYC before you can go online.
      </p>
      <CreateDeliveryPartnerForm onSubmit={handleCreate} submitting={submitting} />
    </div>
  );
}

function Sidebar() {
  const { profile } = useDeliveryPartner();

  return (
    <aside className="w-full shrink-0 rounded-xl border border-gray-200 bg-white p-4 md:w-56 md:rounded-none md:border-0 md:border-r">
      <p className="mb-4 truncate text-sm font-semibold text-gray-900">{profile?.fullName}</p>

      {profile?.kycStatus !== 'VERIFIED' && (
        <p className="mb-3 rounded bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-700">
          {profile?.kycStatus === 'REJECTED' ? 'KYC rejected — see dashboard' : 'KYC pending review'}
        </p>
      )}
      {profile?.accountStatus === 'SUSPENDED' && (
        <p className="mb-3 rounded bg-red-50 px-2 py-1.5 text-xs font-medium text-red-700">Account suspended</p>
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
  const { loading, profile } = useDeliveryPartner();

  if (loading) return <div className="py-24 text-center text-gray-400">Loading your profile…</div>;
  if (!profile) return <Onboarding />;

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

export default function DeliveryPartnerLayout() {
  return (
    <DeliveryPartnerProvider>
      <LayoutInner />
    </DeliveryPartnerProvider>
  );
}
