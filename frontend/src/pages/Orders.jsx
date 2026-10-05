import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Receipt } from 'lucide-react';
import toast from '@/utils/toast';
import { orderService } from '../services/orderService';
import OrderStatusBadge from '../components/OrderStatusBadge';
import EmptyState from '../components/EmptyState';
import SmartImage from '../components/SmartImage';

// Orders still moving through the kitchen/delivery flow, as opposed to ones that
// have finished one way or another. Used only for grouping and the accent strip —
// the authoritative status is always the badge.
const LIVE_STATUSES = ['PLACED', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'];

function formatWhen(value) {
  const date = new Date(value);
  const sameDay = date.toDateString() === new Date().toDateString();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today, ${time}` : `${date.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

function OrderCard({ order }) {
  const live = LIVE_STATUSES.includes(order.orderStatus);
  const items = order.items || [];
  const summary = items.map((i) => `${i.quantity}× ${i.name}`).join(' · ');

  return (
    <Link
      to={`/orders/${order._id}`}
      className="group relative flex gap-4 overflow-hidden rounded-2xl border border-gray-200 bg-surface p-4 transition duration-300 hover:-translate-y-0.5 hover:border-brand-600/50 hover:shadow-xl hover:shadow-brand-900/30"
    >
      {/* A live order gets a coloured edge so it stands out in a long history. */}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${live ? 'bg-gradient-to-b from-brand-500 to-brand-700' : 'bg-transparent'}`}
        aria-hidden="true"
      />

      <SmartImage
        src={order.restaurant?.image}
        alt={order.restaurant?.name || 'Restaurant'}
        label={order.restaurant?.name}
        widths={[120, 240]}
        sizes="64px"
        className="h-16 w-16 shrink-0 rounded-xl"
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-gray-900">{order.restaurant?.name || 'Restaurant'}</p>
            <p className="mt-0.5 text-xs text-gray-400">{formatWhen(order.createdAt)}</p>
          </div>
          <OrderStatusBadge status={order.orderStatus} />
        </div>

        {summary && <p className="mt-2 truncate text-sm text-gray-500">{summary}</p>}

        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2.5">
          <span className="text-xs text-gray-400">
            {items.length} item{items.length !== 1 ? 's' : ''}
            {order.paymentMethod ? ` · ${order.paymentMethod === 'COD' ? 'Cash on delivery' : 'Paid online'}` : ''}
          </span>
          <span className="flex items-center gap-1 text-sm font-bold text-gray-900">
            ₹{order.totalAmount.toFixed(2)}
            <ChevronRight size={15} className="text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    orderService
      .list({ limit: 50 })
      .then((res) => setOrders(res.orders))
      .catch((err) => toast.error(err.message || 'Could not load orders'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="py-24 text-center text-gray-400">Loading your orders…</div>;

  if (orders.length === 0) {
    return (
      <div className="mx-auto max-w-md px-4 py-24">
        <EmptyState
          food="drink"
          title="No orders yet"
          description="Your order history will show up here."
          action={
            <Link to="/restaurants" className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Browse restaurants
            </Link>
          }
        />
      </div>
    );
  }

  const live = orders.filter((o) => LIVE_STATUSES.includes(o.orderStatus));
  const past = orders.filter((o) => !LIVE_STATUSES.includes(o.orderStatus));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600/20 text-brand-500">
          <Receipt size={18} />
        </span>
        <h1 className="text-2xl font-bold text-gray-900">Your orders</h1>
      </div>

      {/* In-progress orders float to the top: that's what someone opening this
          page is almost always here to check on. */}
      {live.length > 0 && (
        <section className="mt-6">
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
            In progress
          </p>
          <div className="space-y-3">
            {live.map((order) => (
              <OrderCard key={order._id} order={order} />
            ))}
          </div>
        </section>
      )}

      {past.length > 0 && (
        <section className="mt-8">
          {live.length > 0 && <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Past orders</p>}
          <div className="space-y-3">
            {past.map((order) => (
              <OrderCard key={order._id} order={order} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
