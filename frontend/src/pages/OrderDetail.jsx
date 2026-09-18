import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft } from 'lucide-react';
import { orderService } from '../services/orderService';
import { useAuth } from '../context/AuthContext';
import OrderStatusBadge from '../components/OrderStatusBadge';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';

const CUSTOMER_CANCELLABLE_STATUSES = ['pending', 'confirmed'];

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  function load() {
    setLoading(true);
    orderService
      .getById(id)
      .then(setOrder)
      .catch((err) => setError(err.message || 'Order not found'))
      .finally(() => setLoading(false));
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/orders" className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600">
        <ArrowLeft size={14} /> Back to orders
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{order.restaurant?.name}</h1>
          <p className="mt-1 text-xs text-gray-400">Placed {new Date(order.createdAt).toLocaleString()}</p>
        </div>
        <OrderStatusBadge status={order.orderStatus} />
      </div>

      {order.orderStatus === 'cancelled' && order.cancellationReason && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">Reason: {order.cancellationReason}</p>
      )}

      {order.statusHistory?.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-sm font-semibold text-gray-700">Status history</p>
          <ol className="space-y-1 border-l-2 border-gray-100 pl-4">
            {order.statusHistory.map((entry, i) => (
              <li key={i} className="text-xs text-gray-500">
                <span className="font-medium text-gray-700">{entry.status}</span> — {new Date(entry.changedAt).toLocaleString()}
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-6">
        <p className="mb-2 text-sm font-semibold text-gray-700">Items</p>
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-100 bg-white">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between p-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">
                  {item.quantity} × {item.name}
                </p>
                {item.addons?.length > 0 && <p className="text-xs text-gray-400">{item.addons.map((a) => a.name).join(', ')}</p>}
              </div>
              <p className="text-gray-700">₹{((item.price + item.addons.reduce((a, x) => a + x.price, 0)) * item.quantity).toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-1 rounded-xl border border-gray-100 bg-white p-4 text-sm">
        <div className="flex justify-between text-gray-600"><span>Subtotal</span><span>₹{order.subtotal.toFixed(2)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Delivery fee</span><span>₹{order.deliveryFee.toFixed(2)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Tax</span><span>₹{order.tax.toFixed(2)}</span></div>
        {order.discount > 0 && (
          <div className="flex justify-between text-green-700">
            <span>Discount {order.coupon?.code ? `(${order.coupon.code})` : ''}</span>
            <span>-₹{order.discount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold text-gray-900">
          <span>Total</span><span>₹{order.totalAmount.toFixed(2)}</span>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-gray-100 bg-white p-4 text-sm">
        <p className="font-semibold text-gray-700">Delivery address</p>
        <p className="mt-1 text-gray-600">
          {order.deliveryAddress.addressLine}, {order.deliveryAddress.city}
          {order.deliveryAddress.state ? `, ${order.deliveryAddress.state}` : ''} — {order.deliveryAddress.pincode}
        </p>
        <p className="mt-3 font-semibold text-gray-700">Payment</p>
        <p className="mt-1 text-gray-600">
          {order.paymentMethod === 'COD' ? 'Cash on Delivery' : 'Online Payment'} · {order.paymentStatus}
        </p>
      </div>

      {canCancel && (
        <button
          type="button"
          onClick={() => setConfirmCancel(true)}
          disabled={cancelling}
          className="mt-6 w-full rounded-lg border border-red-200 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          Cancel order
        </button>
      )}

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
