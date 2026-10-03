import { useCallback, useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { Wallet, CheckCircle2, XCircle, Users, Store, TrendingUp } from 'lucide-react';
import { adminService } from '../../services/adminService';
import DateRangePicker, { DEFAULT_RANGE } from '../../components/analytics/DateRangePicker';
import KpiCard from '../../components/analytics/KpiCard';
import SalesTrendChart from '../../components/charts/SalesTrendChart';
import StatusBreakdownChart from '../../components/charts/StatusBreakdownChart';

const money = (value) => (value === null || value === undefined ? null : `₹${Number(value).toFixed(2)}`);
const count = (value) => (value === null || value === undefined ? null : Number(value).toLocaleString());

// A section that a staff member may legitimately not be allowed to see: each
// analytics slice is gated by the permission that governs that data, so a 403
// here is a normal outcome, not an error worth a red toast. It renders as an
// explanation instead, and any other failure still surfaces as a real error.
function Section({ title, subtitle, state, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-surface p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
      </div>
      {state === 'loading' && <p className="py-6 text-center text-sm text-gray-400">Loading…</p>}
      {state === 'forbidden' && (
        <p className="py-6 text-center text-sm text-gray-400">Your role doesn&apos;t include access to this section.</p>
      )}
      {state === 'error' && <p className="py-6 text-center text-sm text-red-600">Couldn&apos;t load this section.</p>}
      {state === 'ready' && children}
    </div>
  );
}

// Each slice is fetched independently so one forbidden or failing section never
// blanks the whole page.
function useSlice(fetcher, params, deps) {
  const [state, setState] = useState('loading');
  const [data, setData] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fetcher, deps);

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    run(params)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setState(err?.status === 403 ? 'forbidden' : 'error');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, JSON.stringify(params)]);

  return { state, data };
}

export default function Analytics() {
  const [range, setRange] = useState(DEFAULT_RANGE);
  // A custom range is only queried once both ends are present — DateRangePicker
  // withholds them until then, so this avoids firing a request the API would 400.
  const ready = range.preset !== 'custom' || (range.startDate && range.endDate);
  const params = ready ? range : null;

  const overview = useSlice((p) => (p ? adminService.getAnalyticsOverview(p) : Promise.resolve(null)), params, []);
  const sales = useSlice((p) => (p ? adminService.getAnalyticsSales(p) : Promise.resolve(null)), params, []);
  const orders = useSlice((p) => (p ? adminService.getAnalyticsOrders(p) : Promise.resolve(null)), params, []);
  const restaurants = useSlice(
    (p) => (p ? adminService.getAnalyticsRestaurants({ ...p, limit: 10 }) : Promise.resolve(null)),
    params,
    []
  );
  const food = useSlice((p) => (p ? adminService.getAnalyticsFood({ ...p, limit: 10 }) : Promise.resolve(null)), params, []);
  const delivery = useSlice((p) => (p ? adminService.getAnalyticsDelivery(p) : Promise.resolve(null)), params, []);
  const payments = useSlice((p) => (p ? adminService.getAnalyticsPayments(p) : Promise.resolve(null)), params, []);

  useEffect(() => {
    if (overview.state === 'error') toast.error('Could not load analytics');
  }, [overview.state]);

  const s = overview.data?.summary;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="mt-0.5 text-xs text-gray-400">
            All windows are UTC. Sales count orders that reached delivered; net sales subtract completed refunds.
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {!ready && <p className="mt-6 text-sm text-gray-400">Pick both dates to load analytics for a custom range.</p>}

      {ready && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            <KpiCard icon={Wallet} label="Net sales" value={money(s?.netSales)} hint={s ? `₹${s.grossSales.toFixed(2)} gross` : undefined} />
            <KpiCard icon={TrendingUp} label="Avg order value" value={money(s?.averageOrderValue)} />
            <KpiCard icon={CheckCircle2} label="Delivered orders" value={count(s?.fulfilledOrders)} hint={s ? `of ${s.totalOrders} placed` : undefined} />
            <KpiCard
              icon={XCircle}
              label="Cancelled / rejected"
              value={s ? count(s.cancelledOrders + s.rejectedOrders) : null}
              tone={s && s.cancelledOrders + s.rejectedOrders > 0 ? 'negative' : 'default'}
            />
            <KpiCard icon={Wallet} label="Refunded" value={money(s?.refunds)} tone={s && s.refunds > 0 ? 'negative' : 'default'} />
            <KpiCard icon={Wallet} label="Discounts given" value={money(s?.discounts)} />
            <KpiCard icon={Users} label="New customers" value={count(s?.newCustomers)} hint={s ? `${s.activeCustomers} active` : undefined} />
            <KpiCard icon={Store} label="Active restaurants" value={count(s?.activeRestaurants)} hint={s ? `of ${s.totalRestaurants}` : undefined} />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Section
              title="Net sales per day"
              subtitle={sales.data ? `${sales.data.summary.orders} delivered orders in range` : undefined}
              state={sales.state}
            >
              {sales.data && <SalesTrendChart data={sales.data.trend} />}
              {sales.data && sales.data.trend.length === 0 && (
                <p className="py-6 text-center text-sm text-gray-400">
                  Pick a bounded range (not “All time”) to see a day-by-day trend.
                </p>
              )}
            </Section>

            <Section
              title="Orders by status"
              subtitle={
                orders.data
                  ? orders.data.summary.completionRate === null
                    ? 'No orders in this range'
                    : `${orders.data.summary.completionRate.toFixed(1)}% completed · ${orders.data.summary.cancellationRate.toFixed(1)}% cancelled`
                  : undefined
              }
              state={orders.state}
            >
              {orders.data && <StatusBreakdownChart data={orders.data.byStatus} />}
            </Section>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Section title="Restaurants by sales" subtitle="Top 10 by gross sales in range" state={restaurants.state}>
              {restaurants.data &&
                (restaurants.data.breakdown.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">No restaurant had orders in this range.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Restaurant</th>
                          <th className="text-right">Orders</th>
                          <th className="text-right">Delivered</th>
                          <th className="text-right">Gross</th>
                          <th className="text-right">AOV</th>
                          <th className="text-right">Rating</th>
                        </tr>
                      </thead>
                      <tbody>
                        {restaurants.data.breakdown.map((r) => (
                          <tr key={r.restaurantId}>
                            <td className="font-medium text-gray-900">{r.name}</td>
                            <td className="text-right">{r.orders}</td>
                            <td className="text-right">{r.fulfilledOrders}</td>
                            <td className="text-right font-bold text-gray-900">₹{r.grossSales.toFixed(2)}</td>
                            <td className="text-right">₹{r.averageOrderValue.toFixed(2)}</td>
                            <td className="text-right">
                              {r.reviewCount > 0 ? `${r.rating.toFixed(1)} (${r.reviewCount})` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </Section>

            <Section title="Menu items by quantity" subtitle="Top 10 sold in range, delivered orders only" state={food.state}>
              {food.data &&
                (food.data.breakdown.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-400">No items were sold in this range.</p>
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
                        {food.data.breakdown.map((f) => (
                          <tr key={f.foodId}>
                            <td className="font-medium text-gray-900">{f.name}</td>
                            <td className="text-right">{f.quantity}</td>
                            <td className="text-right">{f.orderCount}</td>
                            <td className="text-right font-bold text-gray-900">₹{f.sales.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </Section>
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Section title="Delivery operations" state={delivery.state}>
              {delivery.data && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Assignments created" value={count(delivery.data.summary.assignmentsCreated)} />
                  <Metric label="Completed" value={count(delivery.data.summary.completed)} />
                  <Metric label="Cancelled" value={count(delivery.data.summary.cancelled)} />
                  <Metric label="Expired / rejected" value={count(delivery.data.summary.expired + delivery.data.summary.rejected)} />
                  <Metric
                    label="Avg completion"
                    value={
                      delivery.data.summary.averageCompletionMinutes === null
                        ? null
                        : `${delivery.data.summary.averageCompletionMinutes.toFixed(1)} min`
                    }
                    hint={
                      delivery.data.summary.measuredCompletions > 0
                        ? `from ${delivery.data.summary.measuredCompletions} timed deliveries`
                        : undefined
                    }
                  />
                  <Metric label="Active riders" value={count(delivery.data.summary.activeDeliveryPartners)} />
                  <Metric label="Rider earnings (net)" value={money(delivery.data.earnings.netEarnings)} />
                  <Metric label="Unsettled earnings" value={money(delivery.data.earnings.pendingEarnings)} />
                </div>
              )}
            </Section>

            <Section title="Payments & refunds" state={payments.state}>
              {payments.data && (
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Metric label="Paid online orders" value={count(payments.data.online.paidOrders)} hint={`${payments.data.online.totalAttempts} attempts`} />
                  <Metric label="Online paid amount" value={money(payments.data.online.paidAmount)} />
                  <Metric label="Failed attempts" value={count(payments.data.online.failedAttempts)} />
                  <Metric label="COD orders" value={count(payments.data.cod.orders)} hint={money(payments.data.cod.amount)} />
                  <Metric label="Refunds completed" value={count(payments.data.refunds.completed)} hint={money(payments.data.refunds.completedAmount)} />
                  <Metric
                    label="Refunds in flight"
                    value={count(payments.data.refunds.pending + payments.data.refunds.processing)}
                    hint="pending or processing"
                  />
                </div>
              )}
            </Section>
          </div>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, hint }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-400">{label}</p>
      {value === null || value === undefined ? (
        <p className="mt-0.5 text-sm font-medium text-gray-400">No data</p>
      ) : (
        <p className="mt-0.5 text-lg font-semibold text-gray-900">{value}</p>
      )}
      {hint && value !== null && value !== undefined && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
