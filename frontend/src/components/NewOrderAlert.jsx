import { useCallback, useEffect, useRef, useState } from 'react';
import { BellRing, Clock } from 'lucide-react';
import toast from '@/utils/toast';
import { useRestaurantOwner } from '../context/RestaurantOwnerContext';
import { orderService } from '../services/orderService';

const POLL_MS = 15000;
const PREP_OPTIONS = [15, 20, 30, 45, 60];
const DEFAULT_PREP_MINUTES = 30;

// A repeating two-tone chime for as long as an order is waiting to be answered.
// Synthesised with the Web Audio API rather than shipping an audio file: no asset
// to load (so it can never be the thing that fails), and no autoplay of a media
// element. Browsers still refuse to start audio until the page has been
// interacted with, so every call is defensive — a silent alert is a degraded
// alert, but a thrown error would take the whole dialog down with it.
function useOrderAlarm(active) {
  const ctxRef = useRef(null);

  useEffect(() => {
    if (!active) return undefined;

    function chime() {
      try {
        if (!ctxRef.current) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return;
          ctxRef.current = new Ctx();
        }
        const ctx = ctxRef.current;
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});

        const startedAt = ctx.currentTime;
        [880, 1174].forEach((frequency, i) => {
          const offset = i * 0.18;
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = 'sine';
          oscillator.frequency.value = frequency;
          // Ramped rather than switched, so it reads as a chime instead of a click.
          gain.gain.setValueAtTime(0.0001, startedAt + offset);
          gain.gain.exponentialRampToValueAtTime(0.2, startedAt + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + offset + 0.16);
          oscillator.connect(gain).connect(ctx.destination);
          oscillator.start(startedAt + offset);
          oscillator.stop(startedAt + offset + 0.18);
        });
      } catch {
        /* Audio is a nicety; the visual alert is the real notification. */
      }
    }

    chime();
    const timer = setInterval(chime, 2500);
    return () => clearInterval(timer);
  }, [active]);
}

// Full-screen interrupt for orders the kitchen hasn't answered yet. Mounted once by
// the restaurant-owner layout, so it follows the owner across every page of their
// console rather than only firing while the Orders tab happens to be open.
export default function NewOrderAlert({ onHandled }) {
  const { selectedRestaurant } = useRestaurantOwner();
  const [pending, setPending] = useState([]);
  const [prepMinutes, setPrepMinutes] = useState(DEFAULT_PREP_MINUTES);
  const [busy, setBusy] = useState(false);
  // Orders this session has already acted on. A status change can take a moment to
  // be reflected by the next poll, and without this the dialog would pop straight
  // back up for an order the owner just accepted.
  const handledRef = useRef(new Set());

  const current = pending[0] || null;
  useOrderAlarm(Boolean(current));

  const poll = useCallback(() => {
    if (!selectedRestaurant) return;
    orderService
      .list({ restaurant: selectedRestaurant._id, status: 'PLACED', limit: 20 })
      .then((res) => setPending((res.orders || []).filter((o) => !handledRef.current.has(o._id))))
      .catch(() => {
        /* A failed poll is not worth a toast every 15s; the next one may succeed. */
      });
  }, [selectedRestaurant]);

  useEffect(() => {
    handledRef.current = new Set();
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [poll]);

  // Each order gets the default cook time rather than inheriting whatever was
  // picked for the previous one.
  useEffect(() => {
    setPrepMinutes(DEFAULT_PREP_MINUTES);
  }, [current?._id]);

  async function respond(status, minutes) {
    if (!current) return;
    const orderId = current._id;
    setBusy(true);
    try {
      await orderService.updateStatus(orderId, status, minutes);
      handledRef.current.add(orderId);
      setPending((list) => list.filter((o) => o._id !== orderId));
      toast.success(status === 'CONFIRMED' ? `Order accepted — ${minutes} min to cook` : 'Order rejected');
      if (onHandled) onHandled();
    } catch (err) {
      toast.error(err.message || 'Could not update the order');
    } finally {
      setBusy(false);
    }
  }

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-brand-600/40 bg-surface shadow-2xl shadow-black/50">
        <div className="flex items-center gap-3 bg-gradient-to-r from-brand-600 to-brand-800 px-5 py-4 text-white">
          <BellRing size={22} className="animate-bounce" />
          <div>
            <p className="font-semibold">New order received</p>
            <p className="text-xs text-white/75">
              {pending.length > 1 ? `${pending.length} orders waiting` : 'Waiting for your response'}
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-semibold text-gray-900">₹{current.totalAmount?.toFixed(2)}</span>
            <span className="text-gray-400">
              {current.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Paid online'}
            </span>
          </div>

          <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto rounded-lg border border-gray-200 p-3 text-sm">
            {current.items?.map((item, i) => (
              <li key={i} className="flex justify-between gap-3 text-gray-600">
                <span>
                  {item.quantity} × {item.name}
                </span>
                <span className="shrink-0">₹{(item.price * item.quantity).toFixed(2)}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gray-400">
            <Clock size={13} /> How long to cook?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PREP_OPTIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setPrepMinutes(minutes)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  prepMinutes === minutes
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-gray-300 text-gray-500 hover:border-brand-600 hover:text-gray-900'
                }`}
              >
                {minutes} min
              </button>
            ))}
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => respond('REJECTED')}
              className="flex-1 rounded-lg border border-red-500/50 py-2.5 text-sm font-semibold text-red-400 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => respond('CONFIRMED', prepMinutes)}
              className="flex-[2] rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : `Accept · ${prepMinutes} min`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
