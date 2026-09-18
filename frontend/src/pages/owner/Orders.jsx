import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { orderService } from '../../services/orderService';
import OrderStatusBadge from '../../components/OrderStatusBadge';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import { ClipboardList } from 'lucide-react';

// Primary forward action per status — mirrors the backend's ORDER_STATUS_TRANSITIONS
// (Phase 2/7), just surfaced as one obvious next step instead of every technically
// allowed transition.
const NEXT_ACTION = {
  pending: { label: 'Accept', status: 'confirmed' },
  confirmed: { label: 'Start preparing', status: 'preparing' },
  preparing: { label: 'Mark ready for pickup', status: 'ready_for_pickup' },
  ready_for_pickup: { label: 'Out for delivery', status: 'out_for_delivery' },
  out_for_delivery: { label: 'Mark delivered', status: 'delivered' },
};
const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'preparing'];

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'out_for_delivery', label: 'Out for delivery' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function Orders() {
  const { selectedRestaurant } = useRestaurantOwner();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  function load() {
    if (!selectedRestaurant) return;
    setLoading(true);
    orderService
      .list({ restaurant: selectedRestaurant._id, status: statusFilter || undefined, limit: 100 })
      .then((res) => setOrders(res.orders))
      .catch((err) => toast.error(err.message || 'Could not load orders'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [selectedRestaurant, statusFilter]);

  async function advance(orderId, nextStatus) {
    setBusyId(orderId);
    try {
      await orderService.updateStatus(orderId, nextStatus);
      toast.success('Order updated');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update order');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject() {
    const orderId = rejecting;
    setRejecting(null);
    setBusyId(orderId);
    try {
      await orderService.updateStatus(orderId, 'rejected');
      toast.success('Order rejected');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not reject order');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCancel() {
    const orderId = cancelling;
    setCancelling(null);
    setBusyId(orderId);
    try {
      await orderService.cancel(orderId, 'Cancelled by restaurant');
      toast.success('Order cancelled');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not cancel order');
    } finally {
      setBusyId(null);
    }
  }

  if (!selectedRestaurant) return null;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Orders</h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading orders…</p>
      ) : orders.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No orders" description="Orders for this filter will show up here." />
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((order) => {
            const next = NEXT_ACTION[order.orderStatus];
            const canCancel = CANCELLABLE_STATUSES.includes(order.orderStatus);
            const busy = busyId === order._id;

            return (
              <div key={order._id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleString()}</p>
                    <p className="mt-1 text-sm text-gray-600">
                      {order.items.length} item{order.items.length !== 1 ? 's' : ''} · ₹{order.totalAmount.toFixed(2)} ·{' '}
                      {order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Online'}
                    </p>
                  </div>
                  <OrderStatusBadge status={order.orderStatus} />
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {order.orderStatus === 'pending' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setRejecting(order._id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  )}
                  {next && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => advance(order._id, next.status)}
                      className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {next.label}
                    </button>
                  )}
                  {canCancel && order.orderStatus !== 'pending' && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setCancelling(order._id)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Cancel order
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!rejecting}
        title="Reject this order?"
        description="The customer will be notified their order was rejected."
        confirmLabel="Reject"
        onConfirm={handleReject}
        onCancel={() => setRejecting(null)}
      />
      <ConfirmDialog
        open={!!cancelling}
        title="Cancel this order?"
        description="This cannot be undone."
        confirmLabel="Cancel order"
        onConfirm={handleCancel}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}
