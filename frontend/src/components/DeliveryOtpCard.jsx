import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { orderService } from '../services/orderService';

// Shown on the customer's own order-detail page while OUT_FOR_DELIVERY. Fetches
// fresh from the authenticated backend every time it mounts (never cached in
// localStorage/sessionStorage/Redux) — there is no reason to persist it
// client-side when the backend can always be asked again while it's still valid.
export default function DeliveryOtpCard({ orderId }) {
  const [state, setState] = useState(null); // the raw { available, otp?, ... } response
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    orderService
      .getDeliveryOtp(orderId)
      .then((res) => !cancelled && setState(res))
      .catch(() => !cancelled && setState({ available: false }))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading || !state?.available) return null;

  return (
    <div className="mt-6 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm">
      <p className="flex items-center gap-1.5 font-semibold text-gray-900">
        <ShieldCheck size={16} /> Delivery OTP
      </p>
      <p className="mt-1 text-xs text-gray-600">Share this OTP with your delivery partner only when you receive your order.</p>
      <p className="mt-3 text-center text-3xl font-bold tracking-[0.4em] text-brand-700">{state.otp}</p>
      {typeof state.attemptsRemaining === 'number' && state.attemptsRemaining < 5 && (
        <p className="mt-2 text-center text-xs text-amber-600">{state.attemptsRemaining} attempt{state.attemptsRemaining === 1 ? '' : 's'} remaining</p>
      )}
    </div>
  );
}
