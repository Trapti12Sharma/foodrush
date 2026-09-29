import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ClipboardList, Wallet, Clock, CheckCircle2, ListOrdered, TrendingUp, XCircle, Star } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { restaurantService } from '../../services/restaurantService';
import DateRangePicker, { DEFAULT_RANGE } from '../../components/analytics/DateRangePicker';
import KpiCard from '../../components/analytics/KpiCard';
import SalesTrendChart from '../../components/charts/SalesTrendChart';
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

const money = (value) => (value === null || value === undefined ? null : `₹${Number(value).toFixed(2)}`);
const percent = (value) => (value === null || value === undefined ? null : `${Number(value).toFixed(1)}%`);

export default function Dashboard() {
  const { selectedRestaurant } = useRestaurantOwner();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // M16 — the date-ranged analytics section, alongside the existing all-time
  // counters above it (which stay exactly as they were).
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsState, setAnalyticsState] = useState('loading');

  useEffect(() => {
    if (!selectedRestaurant) return;
    setLoading(true);
    restaurantService
      .getDashboard(selectedRestaurant._id)
      .then(setStats)
      .catch((err) => toast.error(err.message || 'Could not load dashboard'))
      .finally(() => setLoading(false));
  }, [selectedRestaurant]);

  const rangeReady = range.preset !== 'custom' || (range.startDate && range.endDate);

  useEffect(() => {
    if (!selectedRestaurant || !rangeReady) return undefined;
    let cancelled = false;
    setAnalyticsState('loading');
    restaurantService
      .getAnalytics(selectedRestaurant._id, { ...range, limit: 5 })
      .then((res) => {
        if (cancelled) return;
        setAnalytics(res);
        setAnalyticsState('ready');
      })
      .catch(() => {
        if (!cancelled) setAnalyticsState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRestaurant, range, rangeReady]);

  if (!selectedRestaurant) return null;

  const a = analytics?.summary;

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

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Analytics</h2>
          <p className="mt-0.5 text-xs text-gray-400">
            All windows are UTC. Net sales subtract completed refunds from delivered-order sales.
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {!rangeReady && <p className="mt-4 text-sm text-gray-400">Pick both dates to load a custom range.</p>}
      {rangeReady && analyticsState === 'loading' && <p className="mt-4 text-sm text-gray-400">Loading analytics…</p>}
      {rangeReady && analyticsState === 'error' && <p className="mt-4 text-sm text-red-600">Couldn&apos;t load analytics for this range.</p>}

      {rangeReady && analyticsState === 'ready' && a && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard icon={Wallet} label="Net sales" value={money(a.netSales)} hint={`₹${a.grossSales.toFixed(2)} gross`} />
            <KpiCard icon={TrendingUp} label="Avg order value" value={money(a.averageOrderValue)} />
            <KpiCard icon={CheckCircle2} label="Delivered" value={a.fulfilledOrders} hint={`of ${a.totalOrders} placed`} />
            <KpiCard
              icon={XCircle}
              label="Cancelled"
              value={a.cancelledOrders + a.rejectedOrders}
              tone={a.cancelledOrders + a.rejectedOrders > 0 ? 'negative' : 'default'}
            />
            <KpiCard icon={Wallet} label="Discounts" value={money(a.discounts)} />
            <KpiCard
              icon={Star}
              label="Rating in range"
              value={a.averageRatingInRange === null ? null : a.averageRatingInRange.toFixed(1)}
              hint={a.reviewsInRange > 0 ? `${a.reviewsInRange} new review${a.reviewsInRange === 1 ? '' : 's'}` : undefined}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Net sales per day</h3>
              {analytics.trend.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  Pick a bounded range (not “All time”) to see a day-by-day trend.
                </p>
              ) : (
                <SalesTrendChart data={analytics.trend} />
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Orders by status</h3>
              <p className="mb-3 text-xs text-gray-400">
                {a.completionRate === null
                  ? 'No orders in this range'
                  : `${percent(a.completionRate)} completed · ${percent(a.cancellationRate)} cancelled`}
              </p>
              <StatusBreakdownChart data={analytics.byStatus} />
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">Top menu items</h3>
            <p className="mb-3 text-xs text-gray-400">By quantity sold in delivered orders. Item sales exclude delivery fee and tax.</p>
            {analytics.topItems.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">Nothing was sold in this range.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-gray-400">
                  <tr>
                    <th className="pb-2">Item</th>
                    <th className="pb-2 text-right">Qty</th>
                    <th className="pb-2 text-right">Orders</th>
                    <th className="pb-2 text-right">Sales</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {analytics.topItems.map((item) => (
                    <tr key={item.foodId}>
                      <td className="py-2 text-gray-800">{item.name}</td>
                      <td className="py-2 text-right text-gray-600">{item.quantity}</td>
                      <td className="py-2 text-right text-gray-600">{item.orderCount}</td>
                      <td className="py-2 text-right font-medium text-gray-900">₹{item.sales.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
