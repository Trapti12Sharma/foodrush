import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from '@/utils/toast';
import { adminService } from '../../services/adminService';
import OrderStatusBadge from '../../components/OrderStatusBadge';
import Pagination from '../../components/Pagination';

const PAGE_SIZE = 10;

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
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  function load() {
    setLoading(true);
    adminService
      .listOrders({ status: statusFilter || undefined, page, limit: PAGE_SIZE })
      .then((res) => {
        setOrders(res.orders);
        setPagination(res.pagination || null);
      })
      .catch((err) => toast.error(err.message || 'Could not load orders'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  useEffect(load, [page, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="mt-6 overflow-hidden rounded-2xl border border-brand-300/20 shadow-xl shadow-black/30">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Restaurant</th>
                  <th>Placed</th>
                  <th>Payment</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order._id}>
                    <td className="font-semibold text-gray-900">{order.restaurant?.name}</td>
                    <td className="whitespace-nowrap">
                      {new Date(order.createdAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}
                      <span className="ml-1 text-gray-400">
                        {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </td>
                    <td>
                      <span className="text-gray-600">{order.paymentMethod === 'COD' ? 'COD' : 'Online'}</span>
                      <span
                        className={`ml-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${order.paymentStatus === 'paid'
                            ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                            : order.paymentStatus === 'failed'
                              ? 'bg-rose-500/15 text-rose-300 ring-rose-500/30'
                              : 'bg-white/10 text-gray-500 ring-white/15'
                          }`}
                      >
                        {order.paymentStatus}
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-right font-bold text-gray-900">
                      ₹{order.totalAmount.toFixed(2)}
                    </td>
                    <td>
                      <OrderStatusBadge status={order.orderStatus} />
                    </td>
                    <td className="text-right">
                      <Link to={`/orders/${order._id}`} className="table-action-btn">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orders.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No orders found.</p>}
          <Pagination meta={pagination} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
