import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList } from 'lucide-react';
import toast from 'react-hot-toast';
import { orderService } from '../services/orderService';
import OrderStatusBadge from '../components/OrderStatusBadge';
import EmptyState from '../components/EmptyState';

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
          icon={ClipboardList}
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold text-gray-900">Your orders</h1>
      <div className="mt-6 space-y-3">
        {orders.map((order) => (
          <Link
            key={order._id}
            to={`/orders/${order._id}`}
            className="block rounded-xl border border-gray-200 bg-white p-4 hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">{order.restaurant?.name}</p>
                <p className="mt-1 text-xs text-gray-400">{new Date(order.createdAt).toLocaleString()}</p>
              </div>
              <OrderStatusBadge status={order.orderStatus} />
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-gray-500">{order.items.length} item{order.items.length !== 1 ? 's' : ''}</span>
              <span className="font-semibold text-gray-900">₹{order.totalAmount.toFixed(2)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
