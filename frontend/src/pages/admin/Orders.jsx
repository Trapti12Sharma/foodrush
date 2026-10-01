import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from '@/utils/toast';
import { adminService } from '../../services/adminService';
import OrderStatusBadge from '../../components/OrderStatusBadge';

const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'PLACED', label: 'Placed' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'REFUND_PENDING', label: 'Refund pending' },
  { value: 'REFUNDED', label: 'Refunded' },
];

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    adminService
      .listOrders({ status: statusFilter || undefined, limit: 100 })
      .then((res) => setOrders(res.orders))
      .catch((err) => toast.error(err.message || 'Could not load orders'))
      .finally(() => setLoading(false));
  }, [statusFilter]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">All orders</h1>
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
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] shadow-lg shadow-black/20 backdrop-blur-xl">
          <table className="w-full text-sm">
            <thead className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-4 py-3 font-semibold">Restaurant</th>
                <th className="px-4 py-3 font-semibold">Placed</th>
                <th className="px-4 py-3 font-semibold">Payment</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.07]">
              {orders.map((order) => (
                <tr key={order._id} className="transition hover:bg-white/[0.04]">
                  <td className="px-4 py-3 font-medium text-gray-900">{order.restaurant?.name}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-500">
                    {new Date(order.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                    <span className="text-gray-400">
                      {' '}
                      {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-gray-600">{order.paymentMethod === 'COD' ? 'COD' : 'Online'}</span>
                    {/* Payment state is its own signal — a failed payment on a
                        delivered order matters more than either value alone. */}
                    <span
                      className={`ml-1.5 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                        order.paymentStatus === 'paid'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : order.paymentStatus === 'failed'
                            ? 'bg-rose-500/15 text-rose-300'
                            : 'bg-white/10 text-gray-500'
                      }`}
                    >
                      {order.paymentStatus}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900">
                    ₹{order.totalAmount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={order.orderStatus} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/orders/${order._id}`}
                      className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-600 transition hover:border-brand-600 hover:text-gray-900"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {orders.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No orders found.</p>}
        </div>
      )}
    </div>
  );
}
