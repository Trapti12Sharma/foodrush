import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Bike, Wallet, MapPin, Store, Clock, Navigation, Radio, ShieldCheck } from 'lucide-react';
import { useDeliveryPartner } from '../../context/DeliveryPartnerContext';
import { deliveryPartnerService } from '../../services/deliveryPartnerService';
import { deliveryAssignmentService } from '../../services/deliveryAssignmentService';
import { useLocationSharing } from '../../hooks/useLocationSharing';

// No push notifications yet (Socket.IO is a later milestone) — the dashboard polls
// for new offers while it's open. A rider must have the app/tab open to see one.
const OFFERS_POLL_MS = 15000;

function useCountdown(expiresAt) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(expiresAt).getTime() - Date.now());
  useEffect(() => {
    const tick = () => setRemainingMs(new Date(expiresAt).getTime() - Date.now());
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);
  return Math.max(0, Math.round(remainingMs / 1000));
}

function OfferCard({ offer, onAccept, onReject, busy }) {
  const secondsLeft = useCountdown(offer.expiresAt);
  const order = offer.order;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Store size={14} /> {order?.restaurant?.name || 'Restaurant'}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
            <MapPin size={12} /> Deliver to {order?.deliveryAddress?.city}
            {order?.deliveryAddress?.state ? `, ${order.deliveryAddress.state}` : ''}
          </p>
          {offer.distanceKmAtOffer != null && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
              <Navigation size={12} /> ~{offer.distanceKmAtOffer} km from you
            </p>
          )}
          <p className="mt-1 text-xs text-gray-500">
            {order?.paymentMethod === 'COD' ? `Collect ₹${order?.totalAmount?.toFixed(2)} on delivery` : 'Prepaid order'}
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-1 text-xs font-medium text-amber-700">
          <Clock size={12} /> {secondsLeft > 0 ? `${secondsLeft}s` : 'Expiring…'}
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy || secondsLeft === 0}
          onClick={() => onAccept(offer._id)}
          className="flex-1 rounded-lg bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Accept
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onReject(offer._id)}
          className="flex-1 rounded-lg border border-gray-300 bg-white py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

const SHARING_TEXT = {
  idle: 'Location sharing is off',
  requesting: 'Requesting location permission…',
  sharing: 'Location sharing active',
  denied: 'Location permission denied — enable it in your browser/device settings to share your location',
  timeout: 'Could not get your location (timed out) — try again',
  unavailable: 'Location unavailable right now',
  unsupported: 'This browser does not support location sharing',
};
const SHARING_STYLE = {
  sharing: 'text-green-700',
  idle: 'text-gray-500',
};

function LocationSharingControl({ assignmentId }) {
  const { state, lastSentAt, start, stop } = useLocationSharing(assignmentId);
  const isSharing = state === 'sharing' || state === 'requesting';

  return (
    <div className="mt-3 rounded-lg bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className={`flex items-center gap-1.5 text-xs font-medium ${SHARING_STYLE[state] || 'text-amber-700'}`}>
          <Radio size={12} /> {SHARING_TEXT[state]}
        </p>
        <button
          type="button"
          onClick={isSharing ? stop : start}
          disabled={state === 'unsupported'}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${
            isSharing ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-brand-600 text-white hover:bg-brand-700'
          }`}
        >
          {isSharing ? 'Stop sharing' : 'Start sharing'}
        </button>
      </div>
      {state === 'sharing' && lastSentAt && (
        <p className="mt-1 text-xs text-gray-400">Last sent {lastSentAt.toLocaleTimeString()}</p>
      )}
    </div>
  );
}

function OtpVerifyForm({ assignmentId, onDelivered }) {
  const [otp, setOtp] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const isValidFormat = /^\d{6}$/.test(otp);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValidFormat || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { order } = await deliveryAssignmentService.verifyOtp(assignmentId, otp);
      toast.success('Delivery completed!');
      onDelivered(order);
    } catch (err) {
      setError(err.message || 'Could not verify this OTP');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 rounded-lg bg-white p-3">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
        <ShieldCheck size={14} /> Enter delivery OTP
      </p>
      <p className="mt-1 text-xs text-gray-500">Ask the customer for the 6-digit code shown on their order page.</p>
      <div className="mt-2 flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={otp}
          onChange={(e) => {
            setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
            setError(null);
          }}
          placeholder="123456"
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-brand-400"
        />
        <button
          type="submit"
          disabled={!isValidFormat || submitting}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Verifying…' : 'Complete Delivery'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </form>
  );
}

function CurrentDeliveryCard({ assignment, onDelivered }) {
  const order = assignment.order;
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-brand-700">Current delivery</p>
      <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
        <Store size={14} /> {order?.restaurant?.name || 'Restaurant'}
      </p>
      {order?.restaurant?.address?.addressLine && (
        <p className="mt-1 text-xs text-gray-600">Pickup: {order.restaurant.address.addressLine}, {order.restaurant.city}</p>
      )}
      <p className="mt-1 flex items-center gap-1.5 text-xs text-gray-600">
        <MapPin size={12} /> Deliver to {order?.deliveryAddress?.addressLine}, {order?.deliveryAddress?.city}
      </p>
      {order?.deliveryAddress?.name && (
        <p className="mt-1 text-xs text-gray-600">Customer: {order.deliveryAddress.name} {order.deliveryAddress.phone ? `· ${order.deliveryAddress.phone}` : ''}</p>
      )}
      <p className="mt-1 text-xs text-gray-500">
        Order {order?.orderNumber} · {order?.paymentMethod === 'COD' ? `Collect ₹${order?.totalAmount?.toFixed(2)}` : 'Prepaid'}
      </p>
      <LocationSharingControl assignmentId={assignment._id} />
      <OtpVerifyForm assignmentId={assignment._id} onDelivered={onDelivered} />
    </div>
  );
}

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
  const [offers, setOffers] = useState([]);
  const [currentDelivery, setCurrentDelivery] = useState(null);
  const [respondingId, setRespondingId] = useState(null);

  const eligibleToGoOnline = profile.accountStatus === 'ACTIVE' && profile.kycStatus === 'VERIFIED';
  const isOnline = profile.availability === 'ONLINE';

  const load = useCallback(() => {
    deliveryAssignmentService
      .myCurrentDelivery()
      .then(setCurrentDelivery)
      .catch(() => setCurrentDelivery(null));
    deliveryAssignmentService
      .myOffers()
      .then(setOffers)
      .catch(() => setOffers([]));
  }, []);

  useEffect(() => {
    load();
    if (!isOnline) return undefined;
    const interval = setInterval(load, OFFERS_POLL_MS);
    return () => clearInterval(interval);
  }, [load, isOnline]);

  async function toggleAvailability() {
    setToggling(true);
    try {
      const updated = await deliveryPartnerService.setAvailability(isOnline ? 'OFFLINE' : 'ONLINE');
      setProfile(updated);
      toast.success(updated.availability === 'ONLINE' ? "You're online" : "You're offline");
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update your availability');
    } finally {
      setToggling(false);
    }
  }

  async function handleAccept(id) {
    setRespondingId(id);
    try {
      await deliveryAssignmentService.accept(id);
      toast.success('Delivery accepted!');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not accept this delivery');
      load(); // the offer may have expired or been taken — refresh either way
    } finally {
      setRespondingId(null);
    }
  }

  async function handleReject(id) {
    setRespondingId(id);
    try {
      await deliveryAssignmentService.reject(id);
      toast('Delivery declined', { icon: '👋' });
      load();
    } catch (err) {
      toast.error(err.message || 'Could not decline this delivery');
    } finally {
      setRespondingId(null);
    }
  }

  // Refreshing from the server (rather than just clearing local state) is what
  // actually stops location sharing too: currentDelivery becomes null, so
  // CurrentDeliveryCard (and the LocationSharingControl/useLocationSharing hook
  // inside it) unmounts, which already stops navigator.geolocation.watchPosition
  // and disconnects its socket on cleanup — no separate "stop tracking" call needed.
  function handleDelivered() {
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      {currentDelivery && <CurrentDeliveryCard assignment={currentDelivery} onDelivered={handleDelivered} />}

      {isOnline && !currentDelivery && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold text-gray-900">Delivery offers</p>
          {offers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">
              No offers right now — they&apos;ll appear here as soon as one comes in.
            </p>
          ) : (
            <div className="space-y-3">
              {offers.map((offer) => (
                <OfferCard key={offer._id} offer={offer} onAccept={handleAccept} onReject={handleReject} busy={respondingId === offer._id} />
              ))}
            </div>
          )}
        </div>
      )}

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
