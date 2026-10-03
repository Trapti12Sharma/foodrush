import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { ClipboardList, Wallet, Clock, CheckCircle2, ListOrdered, TrendingUp, XCircle, Star } from 'lucide-react';
import { useRestaurantOwner } from '../../context/RestaurantOwnerContext';
import { restaurantService } from '../../services/restaurantService';
import DateRangePicker, { DEFAULT_RANGE } from '../../components/analytics/DateRangePicker';
import KpiCard from '../../components/analytics/KpiCard';
import SalesTrendChart from '../../components/charts/SalesTrendChart';
import StatusBreakdownChart from '../../components/charts/StatusBreakdownChart';

// The headline counters reuse KpiCard's frosted-glass treatment so the two bands
// of the dashboard (all-time counters, then ranged analytics) look like one page
// instead of two different designs stacked.
function StatCard({ icon, label, value, accent }) {
  return <KpiCard icon={icon} label={label} value={value} accent={accent} />;
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
          <StatCard icon={Clock} label="Today's orders" value={stats.todayOrders} accent="violet" />
          <StatCard icon={ListOrdered} label="Total orders" value={stats.totalOrders} accent="blue" />
          <StatCard icon={ClipboardList} label="Pending" value={stats.pendingOrders} accent="amber" />
          <StatCard icon={CheckCircle2} label="Delivered" value={stats.deliveredOrders} accent="green" />
          <StatCard icon={Wallet} label="Revenue" value={`₹${stats.revenue.toFixed(2)}`} accent="green" />
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
            <KpiCard icon={Wallet} label="Net sales" value={money(a.netSales)} hint={`₹${a.grossSales.toFixed(2)} gross`} accent="green" />
            <KpiCard icon={TrendingUp} label="Avg order value" value={money(a.averageOrderValue)} accent="violet" />
            <KpiCard icon={CheckCircle2} label="Delivered" value={a.fulfilledOrders} hint={`of ${a.totalOrders} placed`} accent="green" />
            <KpiCard
              icon={XCircle}
              label="Cancelled"
              value={a.cancelledOrders + a.rejectedOrders}
              accent="rose"
              tone={a.cancelledOrders + a.rejectedOrders > 0 ? 'negative' : 'default'}
            />
            <KpiCard icon={Wallet} label="Discounts" value={money(a.discounts)} accent="amber" />
            <KpiCard
              icon={Star}
              label="Rating in range"
              value={a.averageRatingInRange === null ? null : a.averageRatingInRange.toFixed(1)}
              hint={a.reviewsInRange > 0 ? `${a.reviewsInRange} new review${a.reviewsInRange === 1 ? '' : 's'}` : undefined}
              accent="amber"
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-5 shadow-lg shadow-black/20 backdrop-blur-xl">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Net sales per day</h3>
              {analytics.trend.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">
                  Pick a bounded range (not “All time”) to see a day-by-day trend.
                </p>
              ) : (
                <SalesTrendChart data={analytics.trend} />
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-5 shadow-lg shadow-black/20 backdrop-blur-xl">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Orders by status</h3>
              <p className="mb-3 text-xs text-gray-400">
                {a.completionRate === null
                  ? 'No orders in this range'
                  : `${percent(a.completionRate)} completed · ${percent(a.cancellationRate)} cancelled`}
              </p>
              <StatusBreakdownChart data={analytics.byStatus} />
            </div>
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-brand-300/20 shadow-xl shadow-black/30">
            <div className="p-5">
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Top menu items</h3>
              <p className="mb-3 text-xs text-gray-400">By quantity sold in delivered orders. Item sales exclude delivery fee and tax.</p>
            </div>
            {analytics.topItems.length === 0 ? (
              <p className="p-6 pt-0 text-center text-sm text-gray-400">Nothing was sold in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Orders</th>
                      <th className="text-right">Sales</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topItems.map((item) => (
                      <tr key={item.foodId}>
                        <td className="font-semibold text-gray-900">{item.name}</td>
                        <td className="text-right">{item.quantity}</td>
                        <td className="text-right">{item.orderCount}</td>
                        <td className="text-right font-bold text-gray-900">₹{item.sales.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
