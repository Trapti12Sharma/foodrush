import { useState } from 'react';
import toast from 'react-hot-toast';
import { Bike, Wallet } from 'lucide-react';
import { useDeliveryPartner } from '../../context/DeliveryPartnerContext';
import { deliveryPartnerService } from '../../services/deliveryPartnerService';

const KYC_STYLES = {
  PENDING: 'bg-amber-100 text-amber-700',
  SUBMITTED: 'bg-blue-100 text-blue-700',
  VERIFIED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
};

const ACCOUNT_STYLES = {
  PENDING: 'bg-amber-100 text-amber-700',
  ACTIVE: 'bg-green-100 text-green-700',
  SUSPENDED: 'bg-red-100 text-red-700',
  REJECTED: 'bg-red-100 text-red-700',
};

function Badge({ styles, value }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[value] || 'bg-gray-100 text-gray-600'}`}>{value}</span>;
}

export default function Dashboard() {
  const { profile, setProfile } = useDeliveryPartner();
  const [toggling, setToggling] = useState(false);

  const eligibleToGoOnline = profile.accountStatus === 'ACTIVE' && profile.kycStatus === 'VERIFIED';
  const isOnline = profile.availability === 'ONLINE';

  async function toggleAvailability() {
    setToggling(true);
    try {
      const updated = await deliveryPartnerService.setAvailability(isOnline ? 'OFFLINE' : 'ONLINE');
      setProfile(updated);
      toast.success(updated.availability === 'ONLINE' ? "You're online" : "You're offline");
    } catch (err) {
      toast.error(err.message || 'Could not update your availability');
    } finally {
      setToggling(false);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">KYC status</p>
          <div className="mt-2">
            <Badge styles={KYC_STYLES} value={profile.kycStatus} />
          </div>
          {profile.kycStatus === 'REJECTED' && profile.kycRejectionReason && (
            <p className="mt-2 text-sm text-red-600">Reason: {profile.kycRejectionReason}</p>
          )}
          {profile.kycStatus === 'SUBMITTED' && <p className="mt-2 text-sm text-gray-500">Your documents are awaiting admin review.</p>}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Account status</p>
          <div className="mt-2">
            <Badge styles={ACCOUNT_STYLES} value={profile.accountStatus} />
          </div>
          {profile.accountStatus === 'SUSPENDED' && profile.accountStatusReason && (
            <p className="mt-2 text-sm text-red-600">Reason: {profile.accountStatusReason}</p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Availability</p>
            <p className="text-xs text-gray-500">
              {eligibleToGoOnline
                ? 'You can go online to start receiving deliveries.'
                : 'You must be an active, KYC-verified delivery partner to go online.'}
            </p>
          </div>
          <button
            type="button"
            disabled={toggling || (!isOnline && !eligibleToGoOnline)}
            onClick={toggleAvailability}
            className={`rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
              isOnline ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-brand-600 text-white hover:bg-brand-700'
            }`}
          >
            {isOnline ? 'Go offline' : 'Go online'}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Bike size={16} /> Vehicle
        </p>
        <p className="text-sm text-gray-600">
          {profile.vehicleType.charAt(0) + profile.vehicleType.slice(1).toLowerCase()}
          {profile.vehicleNumber ? ` · ${profile.vehicleNumber}` : ''}
        </p>
      </div>

      <div className="mt-4 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-gray-500">
          <Wallet size={16} /> Earnings
        </p>
        <p className="mt-1 text-sm text-gray-400">Coming in a later update — earnings and payouts are not tracked yet.</p>
      </div>
    </div>
  );
}
