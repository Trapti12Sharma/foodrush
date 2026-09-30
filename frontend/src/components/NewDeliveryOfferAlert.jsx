import { useEffect, useRef, useState } from 'react';
import { BellRing, Store, MapPin, Navigation, Clock, IndianRupee } from 'lucide-react';
import useAlertChime from '../hooks/useAlertChime';

// Full-screen interrupt for a delivery offer, with a chime.
//
// DRIVEN BY THE DASHBOARD'S EXISTING POLL, not its own. The rider dashboard
// already fetches offers on a timer; giving this component a second poller would
// double a rider's request rate against a per-IP budget that is already tight
// (see the rate-limit note in NewOrderAlert). So it takes `offers` as a prop and
// only decides how to present them.
//
// Deliberately NOT suppressed when the tab is hidden: a rider who has switched
// to maps or their phone's home screen is exactly who the sound is for.
export default function NewDeliveryOfferAlert({ offers, onAccept, onReject, busyId }) {
  // Offers already answered (or explicitly dismissed) in this session. The next
  // poll can still include an offer for a moment after responding, and without
  // this the dialog would immediately reopen on something already handled.
  const [dismissed, setDismissed] = useState(() => new Set());
  const [secondsLeft, setSecondsLeft] = useState(null);

  const pending = (offers || []).filter((o) => !dismissed.has(o._id));
  const current = pending[0] || null;
  const currentId = current?._id;

  useAlertChime(Boolean(current));

  // Offers expire server-side; showing a live countdown makes the urgency real
  // and stops a rider tapping Accept on something that has already lapsed.
  const expiresAt = current?.expiresAt;
  useEffect(() => {
    if (!expiresAt) {
      setSecondsLeft(null);
      return undefined;
    }
    const tick = () => setSecondsLeft(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  // An offer that lapses while the dialog is open should stop nagging rather
  // than sit there chiming at something the rider can no longer take.
  const lapsedRef = useRef(null);
  useEffect(() => {
    if (secondsLeft === 0 && currentId && lapsedRef.current !== currentId) {
      lapsedRef.current = currentId;
      setDismissed((prev) => new Set(prev).add(currentId));
    }
  }, [secondsLeft, currentId]);

  if (!current) return null;

  const order = current.order;
  const busy = busyId === current._id;

  function respond(action) {
    setDismissed((prev) => new Set(prev).add(current._id));
    action(current._id);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-brand-600/40 bg-surface shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between gap-3 bg-gradient-to-r from-brand-600 to-brand-800 px-5 py-4 text-white">
          <div className="flex items-center gap-3">
            <BellRing size={22} className="animate-bounce" />
            <div>
              <p className="font-semibold">New delivery offer</p>
              <p className="text-xs text-white/75">
                {pending.length > 1 ? `${pending.length} offers waiting` : 'Respond before it expires'}
              </p>
            </div>
          </div>
          {secondsLeft !== null && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 text-sm font-bold">
              <Clock size={13} /> {secondsLeft}s
            </span>
          )}
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-gray-900">
            <Store size={15} className="text-brand-500" /> {order?.restaurant?.name || 'Restaurant'}
          </p>
          {order?.restaurant?.address?.addressLine && (
            <p className="flex items-start gap-2 text-xs text-gray-400">
              <Navigation size={13} className="mt-0.5 shrink-0" /> Pick up from {order.restaurant.address.addressLine}
            </p>
          )}
          <p className="flex items-start gap-2 text-gray-600">
            <MapPin size={15} className="mt-0.5 shrink-0 text-gray-400" />
            Deliver to {order?.deliveryAddress?.city}
            {order?.deliveryAddress?.state ? `, ${order.deliveryAddress.state}` : ''}
          </p>
          {current.distanceKmAtOffer != null && (
            <p className="text-xs text-gray-400">~{current.distanceKmAtOffer} km from you</p>
          )}
          <p className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2 font-medium text-gray-900">
            <IndianRupee size={14} className="text-emerald-400" />
            {order?.paymentMethod === 'COD'
              ? `Collect ₹${order?.totalAmount?.toFixed(2)} on delivery`
              : 'Prepaid — nothing to collect'}
          </p>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => respond(onReject)}
              className="flex-1 rounded-lg border border-gray-300 py-2.5 text-sm font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
            >
              Decline
            </button>
            <button
              type="button"
              disabled={busy || secondsLeft === 0}
              onClick={() => respond(onAccept)}
              className="flex-[2] rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Accepting…' : 'Accept delivery'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
