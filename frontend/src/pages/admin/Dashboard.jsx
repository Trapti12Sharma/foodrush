import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Users, Store, ListOrdered, Clock, CheckCircle2, Wallet } from 'lucide-react';
import { adminService } from '../../services/adminService';
import OrdersTrendChart from '../../components/charts/OrdersTrendChart';
import StatusBreakdownChart from '../../components/charts/StatusBreakdownChart';

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-400">
        <Icon size={16} />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminService
      .getDashboard()
      .then(setStats)
      .catch((err) => toast.error(err.message || 'Could not load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-gray-400">Loading platform stats…</p>;
  if (!stats) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Platform overview</h1>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Users} label="Users" value={stats.totalUsers} />
        <StatCard icon={Store} label="Restaurants" value={stats.totalRestaurants} />
        <StatCard icon={ListOrdered} label="Total orders" value={stats.totalOrders} />
        <StatCard icon={Clock} label="Pending" value={stats.pendingOrders} />
        <StatCard icon={CheckCircle2} label="Delivered" value={stats.deliveredOrders} />
        <StatCard icon={Wallet} label="Revenue" value={`₹${stats.revenue.toFixed(2)}`} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Orders — last 7 days</h2>
          <OrdersTrendChart data={stats.last7Days} />
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Orders by status</h2>
          <StatusBreakdownChart data={stats.statusBreakdown} />
        </div>
      </div>
    </div>
  );
}
