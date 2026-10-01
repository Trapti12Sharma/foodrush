import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from '@/utils/toast';
import { ArrowLeft, Check, MapPin, CreditCard, Bike, ReceiptText, UtensilsCrossed } from 'lucide-react';
import { orderService } from '../services/orderService';
import { useAuth } from '../context/AuthContext';
import OrderStatusBadge, { ORDER_STATUS_LABELS } from '../components/OrderStatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import DeliveryTracker from '../components/DeliveryTracker';
import DeliveryOtpCard from '../components/DeliveryOtpCard';
import { loadRazorpayScript, openRazorpayCheckout } from '../utils/razorpay';

const CUSTOMER_CANCELLABLE_STATUSES = ['PLACED', 'CONFIRMED'];
const RETRYABLE_STATUSES = ['PLACED', 'CONFIRMED'];

// The happy path, in order. Only used to draw the progress tracker — an order
// that ended in CANCELLED/REJECTED/REFUNDED never reaches these, so the tracker
// is hidden entirely for those and the status history remains the full record.
const PROGRESS_STEPS = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const TERMINAL_STATUSES = ['CANCELLED', 'REJECTED', 'REFUND_PENDING', 'REFUNDED'];

const GLASS = 'rounded-2xl border border-gray-200 bg-surface';

function timeOf(value) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Horizontal stepper. Reads left-to-right like the journey itself, and fills the
// width that the old single narrow column was leaving empty.
function ProgressTracker({ order }) {
  if (TERMINAL_STATUSES.includes(order.orderStatus)) return null;
  const currentIndex = PROGRESS_STEPS.indexOf(order.orderStatus);
  if (currentIndex === -1) return null;

  // Timestamps come from the order's own history, so a step shows when it
  // actually happened rather than a guess.
  const timeFor = (status) => {
    const entry = order.statusHistory?.find((h) => h.status === status);
    return entry ? timeOf(entry.changedAt) : null;
  };

  return (
    <div className={`${GLASS} mt-6 p-5`}>
      <div className="flex items-start">
        {PROGRESS_STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          const when = timeFor(step);
          return (
            <div key={step} className="flex min-w-0 flex-1 flex-col items-center">
              <div className="flex w-full items-center">
                {/* Connector before the dot, except on the first step. */}
                <span className={`h-0.5 flex-1 ${i === 0 ? 'bg-transparent' : done || active ? 'bg-brand-600' : 'bg-gray-200'}`} />
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold transition ${
                    done
                      ? 'bg-brand-600 text-white'
                      : active
                        ? 'bg-brand-600 text-white ring-4 ring-brand-600/25'
                        : 'border border-gray-300 bg-surface text-gray-400'
                  }`}
                >
                  {done ? <Check size={14} /> : i + 1}
                </span>
                <span
                  className={`h-0.5 flex-1 ${i === PROGRESS_STEPS.length - 1 ? 'bg-transparent' : done ? 'bg-brand-600' : 'bg-gray-200'}`}
                />
              </div>
              <p className={`mt-2 text-center text-[11px] leading-tight ${active ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
                {ORDER_STATUS_LABELS[step]}
              </p>
              {when && <p className="text-[10px] text-gray-400">{when}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [payingAgain, setPayingAgain] = useState(false);

  function load() {
    setLoading(true);
    orderService
      .getById(id)
      .then(setOrder)
      .catch((err) => setError(err.message || 'Order not found'))
      .finally(() => setLoading(false));
  }

  // Re-fetches without showing the full-page loading state — used when the M8
  // tracking:ended event fires (delivery just completed), so the page flips
  // from OUT_FOR_DELIVERY+OTP straight to "Delivered" without a manual refresh
  // and without flashing a spinner over an already-rendered page.
  function refreshSilently() {
    orderService.getById(id).then(setOrder).catch(() => {});
  }

  useEffect(load, [id]);

  async function handleCancel() {
    setConfirmCancel(false);
    setCancelling(true);
    try {
      const updated = await orderService.cancel(id);
      setOrder(updated);
      toast.success('Order cancelled');
    } catch (err) {
      toast.error(err.message || 'Could not cancel order');
    } finally {
      setCancelling(false);
    }
  }

  async function handleRetryPayment() {
    setPayingAgain(true);
    try {
      const { order: refreshed, razorpay } = await orderService.retryPayment(id);
      setOrder(refreshed);
      const scriptLoaded = await loadRazorpayScript();
      if (!scriptLoaded) {
        toast.error('Could not load the payment gateway. Please try again.');
        return;
      }
      const result = await openRazorpayCheckout({ razorpay, order: refreshed, user });
      const verified = await orderService.verifyPayment(id, {
        razorpayOrderId: result.razorpay_order_id,
        razorpayPaymentId: result.razorpay_payment_id,
        signature: result.razorpay_signature,
      });
      setOrder(verified);
      toast.success('Payment successful!');
    } catch (err) {
      toast.error(err.message === 'Payment window closed' ? 'Payment cancelled' : err.message || 'Payment failed');
      load();
    } finally {
      setPayingAgain(false);
    }
  }

  if (loading) return <div className="py-24 text-center text-gray-400">Loading order…</div>;

  if (error || !order) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <EmptyState
          title="Order not found"
          description={error}
          action={
            <Link to="/orders" className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Back to orders
            </Link>
          }
        />
      </div>
    );
  }

  const isOwnOrder = order.user === user?._id;
  const canCancel = isOwnOrder && CUSTOMER_CANCELLABLE_STATUSES.includes(order.orderStatus);
  const canRetryPayment =
    isOwnOrder &&
    order.paymentMethod === 'ONLINE' &&
    order.paymentStatus !== 'paid' &&
    RETRYABLE_STATUSES.includes(order.orderStatus);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft size={14} /> Back to orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{order.restaurant?.name}</h1>
          <p className="mt-1 text-xs text-gray-400">
            Placed {new Date(order.createdAt).toLocaleString()}
            {order.orderNumber ? ` · ${order.orderNumber}` : ''}
          </p>
        </div>
        <OrderStatusBadge status={order.orderStatus} />
      </div>

      {order.orderStatus === 'CANCELLED' && order.cancellationReason && (
        <p className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          Reason: {order.cancellationReason}
        </p>
      )}

      <ProgressTracker order={order} />

      {/* Two columns from `lg` up: the order itself on the left, the money and
          logistics on the right. Below that it stacks, which is the right
          reading order on a phone. */}
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className={GLASS}>
            <h2 className="flex items-center gap-2 border-b border-gray-200 px-5 py-3 text-sm font-semibold text-gray-900">
              <UtensilsCrossed size={15} className="text-brand-500" /> Items
            </h2>
            <div className="divide-y divide-gray-200">
              {order.items.map((item, i) => (
                <div key={i} className="flex items-start justify-between gap-4 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      <span className="text-brand-500">{item.quantity}×</span> {item.name}
                      {item.variantName && <span className="font-normal text-gray-500"> ({item.variantName})</span>}
                    </p>
                    {item.addons?.length > 0 && <p className="text-xs text-gray-400">{item.addons.map((a) => a.name).join(', ')}</p>}
                    {item.note && <p className="text-xs italic text-gray-400">Note: {item.note}</p>}
                  </div>
                  <p className="shrink-0 font-medium text-gray-700">
                    ₹{((item.price + item.addons.reduce((a, x) => a + x.price, 0)) * item.quantity).toFixed(2)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {order.statusHistory?.length > 0 && (
            <section className={`${GLASS} p-5`}>
              <h2 className="mb-3 text-sm font-semibold text-gray-900">Status history</h2>
              <ol className="space-y-2 border-l-2 border-gray-200 pl-4">
                {order.statusHistory.map((entry, i) => (
                  <li key={i} className="relative text-xs text-gray-500">
                    <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand-600" aria-hidden="true" />
                    <span className="font-medium text-gray-700">{ORDER_STATUS_LABELS[entry.status] || entry.status}</span>
                    {' — '}
                    {new Date(entry.changedAt).toLocaleString()}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {order.orderStatus === 'OUT_FOR_DELIVERY' && order.deliveryPartner && (
            <>
              <DeliveryOtpCard orderId={order._id} />
              <DeliveryTracker orderId={order._id} onDelivered={refreshSilently} />
            </>
          )}
        </div>

        {/* Sticky so the total and the actions stay in view while a long item
            list or status history scrolls past. */}
        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <section className={`${GLASS} p-5 text-sm`}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <ReceiptText size={15} className="text-brand-500" /> Bill summary
            </h2>
            <div className="space-y-1.5">
              <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>₹{order.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between text-gray-600"><span>Delivery fee</span><span>₹{order.deliveryFee.toFixed(2)}</span></div>
              <div className="flex justify-between text-gray-600"><span>Tax</span><span>₹{order.tax.toFixed(2)}</span></div>
              {order.discount > 0 && (
                <div className="flex justify-between text-emerald-400">
                  <span>Discount {order.coupon?.code ? `(${order.coupon.code})` : ''}</span>
                  <span>-₹{order.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="mt-2 flex justify-between border-t border-gray-200 pt-2.5 text-base font-bold text-gray-900">
                <span>Total</span><span>₹{order.totalAmount.toFixed(2)}</span>
              </div>
            </div>
          </section>

          <section className={`${GLASS} p-5 text-sm`}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <MapPin size={15} className="text-brand-500" /> Delivery address
            </h2>
            <p className="text-gray-600">
              {order.deliveryAddress.addressLine}, {order.deliveryAddress.city}
              {order.deliveryAddress.state ? `, ${order.deliveryAddress.state}` : ''} — {order.deliveryAddress.pincode}
            </p>

            <h2 className="mb-2 mt-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
              <CreditCard size={15} className="text-brand-500" /> Payment
            </h2>
            <p className="flex items-center gap-2 text-gray-600">
              {order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Online Payment'}
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                  order.paymentStatus === 'paid'
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : order.paymentStatus === 'failed'
                      ? 'bg-rose-500/15 text-rose-300'
                      : 'bg-white/10 text-gray-500'
                }`}
              >
                {order.paymentStatus}
              </span>
            </p>

            {order.deliveryPartner && (
              <>
                <h2 className="mb-2 mt-4 flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <Bike size={15} className="text-brand-500" /> Delivery partner
                </h2>
                <p className="text-gray-600">
                  {order.deliveryPartner.fullName} · {order.deliveryPartner.vehicleType}
                  {order.deliveryPartner.vehicleNumber ? ` (${order.deliveryPartner.vehicleNumber})` : ''}
                  {order.deliveryPartner.phone ? ` · ${order.deliveryPartner.phone}` : ''}
                </p>
              </>
            )}

            {(order.orderStatus === 'REFUND_PENDING' || order.orderStatus === 'REFUNDED') && (
              <p className="mt-3 text-xs text-gray-500">
                {order.orderStatus === 'REFUNDED' ? 'Your refund has been completed.' : 'Your refund is being processed by the payment gateway.'}
              </p>
            )}
          </section>

          {(canRetryPayment || canCancel) && (
            <div className="space-y-2">
              {canRetryPayment && (
                <button
                  type="button"
                  onClick={handleRetryPayment}
                  disabled={payingAgain}
                  className="w-full rounded-lg bg-gradient-to-r from-brand-600 to-brand-700 py-2.5 text-sm font-semibold text-white transition hover:shadow-md hover:shadow-brand-600/30 disabled:opacity-50"
                >
                  {payingAgain ? 'Opening payment…' : 'Retry payment'}
                </button>
              )}
              {canCancel && (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  disabled={cancelling}
                  className="w-full rounded-lg border border-rose-500/40 py-2.5 text-sm font-semibold text-rose-400 transition hover:bg-rose-500/10 disabled:opacity-50"
                >
                  Cancel order
                </button>
              )}
            </div>
          )}
        </aside>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancel this order?"
        description="This cannot be undone."
        confirmLabel="Cancel order"
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
