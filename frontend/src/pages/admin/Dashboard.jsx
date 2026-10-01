import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from '@/utils/toast';
import { Users, Store, ListOrdered, Clock, CheckCircle2, Wallet, Bike, FileCheck2, ArrowRight, Inbox, ChevronDown } from 'lucide-react';
import { adminService } from '../../services/adminService';
import KpiCard from '../../components/analytics/KpiCard';
import OrdersTrendChart from '../../components/charts/OrdersTrendChart';
import StatusBreakdownChart from '../../components/charts/StatusBreakdownChart';

const GLASS =
  'rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] shadow-lg shadow-black/20 backdrop-blur-xl';

// Applications waiting on an admin. Each row is (label, where the work is done,
// and the query that counts it) — the counts come from the existing admin list
// endpoints' pagination totals, so this needs no new backend endpoint.
const QUEUES = [
  {
    key: 'restaurantApproval',
    label: 'Restaurants awaiting approval',
    description: 'New restaurants cannot take orders until approved.',
    icon: Store,
    to: '/admin/restaurants',
    fetch: () => adminService.listRestaurants({ isApproved: false, limit: 1 }),
  },
  {
    key: 'restaurantKyc',
    label: 'Restaurant KYC to review',
    description: 'FSSAI / PAN / GST documents submitted for verification.',
    icon: FileCheck2,
    to: '/admin/restaurants',
    fetch: () => adminService.listRestaurants({ kycStatus: 'SUBMITTED', limit: 1 }),
  },
  {
    key: 'riderKyc',
    label: 'Delivery partners awaiting KYC',
    description: 'Riders cannot go online until their documents are approved.',
    icon: Bike,
    to: '/admin/delivery-partners',
    fetch: () => adminService.listDeliveryPartners({ kycStatus: 'SUBMITTED', limit: 1 }),
  },
];

function QueueRow({ icon: Icon, label, description, count, to }) {
  const waiting = count > 0;
  return (
    <Link
      to={to}
      className={`flex items-center gap-4 p-4 transition hover:bg-white/[0.04] ${waiting ? '' : 'opacity-60'}`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          waiting ? 'bg-amber-500/20 text-amber-300' : 'bg-white/5 text-gray-400'
        }`}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">{label}</p>
        <p className="truncate text-xs text-gray-400">{description}</p>
      </div>
      <span
        className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${
          waiting ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400'
        }`}
      >
        {count === null ? '—' : count}
      </span>
      <ArrowRight size={16} className="shrink-0 text-gray-400" />
    </Link>
  );
}

// Remembered per browser, not per account — purely "did this admin fold this
// panel last time", the same kind of convenience a sidebar's collapsed state
// would use. Never the source of truth for anything, so a cleared/blocked
// localStorage just falls back to expanded.
const COLLAPSE_KEY = 'foodrush.admin.attentionCollapsed';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  // null while loading / if a count couldn't be fetched, so the row shows "—"
  // rather than claiming a confident zero.
  const [pending, setPending] = useState({});
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        /* Private window / blocked storage — collapsing still works for this render. */
      }
      return next;
    });
  }

  useEffect(() => {
    adminService
      .getDashboard()
      .then(setStats)
      .catch((err) => toast.error(err.message || 'Could not load dashboard'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      QUEUES.map((queue) =>
        queue
          .fetch()
          .then((res) => [queue.key, res?.pagination?.total ?? 0])
          .catch(() => [queue.key, null])
      )
    ).then((entries) => {
      if (!cancelled) setPending(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-sm text-gray-400">Loading platform stats…</p>;
  if (!stats) return null;

  const totalWaiting = QUEUES.reduce((sum, q) => sum + (pending[q.key] || 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Platform overview</h1>

      {/* Sits above the vanity metrics on purpose: this is the only part of the
          page that represents someone waiting on an admin to act. Collapsible
          because once an admin has cleared the queue (or just doesn't want it
          taking up the top of their dashboard every day), there's nothing left
          to act on until the badge count says otherwise. */}
      <section className={`mt-6 overflow-hidden ${GLASS}`}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-white/[0.04]"
        >
          <Inbox size={16} className="text-brand-500" />
          <h2 className="text-sm font-semibold text-gray-900">Needs your attention</h2>
          {totalWaiting > 0 && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-300">
              {totalWaiting}
            </span>
          )}
          <ChevronDown size={16} className={`ml-auto shrink-0 text-gray-400 transition-transform ${collapsed ? '' : 'rotate-180'}`} />
        </button>
        {!collapsed && (
          <div className="divide-y divide-white/10 border-t border-white/10">
            {QUEUES.map((queue) => (
              <QueueRow
                key={queue.key}
                icon={queue.icon}
                label={queue.label}
                description={queue.description}
                count={pending[queue.key] ?? null}
                to={queue.to}
              />
            ))}
          </div>
        )}
      </section>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard icon={Users} label="Users" value={stats.totalUsers} accent="violet" />
        <KpiCard icon={Store} label="Restaurants" value={stats.totalRestaurants} accent="blue" />
        <KpiCard icon={ListOrdered} label="Total orders" value={stats.totalOrders} accent="cyan" />
        <KpiCard icon={Clock} label="Pending" value={stats.pendingOrders} accent="amber" />
        <KpiCard icon={CheckCircle2} label="Delivered" value={stats.deliveredOrders} accent="green" />
        <KpiCard icon={Wallet} label="Revenue" value={`₹${stats.revenue.toFixed(2)}`} accent="green" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className={`${GLASS} p-5`}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Orders — last 7 days</h2>
          <OrdersTrendChart data={stats.last7Days} />
        </div>
        <div className={`${GLASS} p-5`}>
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Orders by status</h2>
          <StatusBreakdownChart data={stats.statusBreakdown} />
        </div>
      </div>
    </div>
  );
}
