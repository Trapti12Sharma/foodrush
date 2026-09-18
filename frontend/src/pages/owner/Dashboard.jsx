import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, Wallet, Clock, CheckCircle2, ListOrdered } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { restaurantService } from '../../services/restaurantService';

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
  const { selectedRestaurant } = useRestaurantOwner();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!selectedRestaurant) return;
    setLoading(true);
    restaurantService
      .getDashboard(selectedRestaurant._id)
      .then(setStats)
      .catch((err) => toast.error(err.message || 'Could not load dashboard'))
      .finally(() => setLoading(false));
  }, [selectedRestaurant]);

  if (!selectedRestaurant) return null;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">{selectedRestaurant.name}</h1>
      <p className="text-sm text-gray-500">
        {selectedRestaurant.isOpen ? 'Open for orders' : 'Closed'} · {selectedRestaurant.city}
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading stats…</p>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard icon={Clock} label="Today's orders" value={stats.todayOrders} />
          <StatCard icon={ListOrdered} label="Total orders" value={stats.totalOrders} />
          <StatCard icon={ClipboardList} label="Pending" value={stats.pendingOrders} />
          <StatCard icon={CheckCircle2} label="Delivered" value={stats.deliveredOrders} />
          <StatCard icon={Wallet} label="Revenue" value={`₹${stats.revenue.toFixed(2)}`} />
        </div>
      )}
    </div>
  );
}
