import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { adminService } from '../../services/adminService';
import ConfirmDialog from '../../components/ConfirmDialog';

const ASSIGNMENT_STYLES = {
  OFFERED: 'bg-amber-100 text-amber-700',
  ACCEPTED: 'bg-blue-100 text-blue-700',
  ASSIGNED: 'bg-green-100 text-green-700',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-gray-200 text-gray-600',
  CANCELLED: 'bg-gray-200 text-gray-600',
  COMPLETED: 'bg-green-100 text-green-700',
};
const STATUS_FILTERS = ['', 'OFFERED', 'ACCEPTED', 'ASSIGNED', 'REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED'];
const ACTIVE_STATUSES = ['OFFERED', 'ACCEPTED', 'ASSIGNED'];

function Badge({ value }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs ${ASSIGNMENT_STYLES[value] || 'bg-gray-100 text-gray-500'}`}>{value}</span>;
}

function WaitingOrderRow({ order, onAssigned }) {
  const [expanded, setExpanded] = useState(false);
  const [riders, setRiders] = useState(null);
  const [busy, setBusy] = useState(false);

  async function loadRiders() {
    setExpanded((prev) => !prev);
    if (riders !== null) return;
    try {
      setRiders(await adminService.listEligibleRiders(order._id));
    } catch (err) {
      toast.error(err.message || 'Could not load eligible riders');
    }
  }

  async function assign(deliveryPartnerId) {
    setBusy(true);
    try {
      await adminService.assignOrder(order._id, deliveryPartnerId);
      toast.success('Delivery offer created');
      onAssigned();
    } catch (err) {
      toast.error(err.message || 'Could not create the assignment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-gray-900">{order.restaurant?.name}</p>
          <p className="text-xs text-gray-400">Order {order.orderNumber} · ₹{order.totalAmount?.toFixed(2)}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => assign(undefined)}
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            Auto-assign
          </button>
          <button type="button" onClick={loadRiders} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
            {expanded ? 'Hide riders' : 'Choose rider'}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
          {riders === null ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : riders.length === 0 ? (
            <p className="text-xs text-gray-400">No eligible online riders nearby right now.</p>
          ) : (
            riders.map((r) => (
              <div key={r._id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span>
                  {r.fullName} · {r.vehicleType} {r.vehicleNumber ? `(${r.vehicleNumber})` : ''} · {r.distanceKm} km away
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => assign(r._id)}
                  className="rounded-lg border border-brand-600 px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 disabled:opacity-50"
                >
                  Assign
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function DeliveryAssignments() {
  const [waitingOrders, setWaitingOrders] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(null);

  function load() {
    setLoading(true);
    Promise.all([
      adminService.listOrders({ status: 'READY_FOR_PICKUP', limit: 50 }),
      adminService.listDeliveryAssignments({ status: statusFilter || undefined, limit: 50 }),
    ])
      .then(([ordersRes, assignmentsRes]) => {
        setWaitingOrders(ordersRes.orders);
        setAssignments(assignmentsRes.assignments);
      })
      .catch((err) => toast.error(err.message || 'Could not load dispatch data'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  async function confirmCancel() {
    const id = cancelling;
    setCancelling(null);
    try {
      await adminService.cancelDeliveryAssignment(id);
      toast.success('Assignment cancelled');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not cancel assignment');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Delivery dispatch</h1>

      <section className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Orders waiting for a rider</h2>
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : waitingOrders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-sm text-gray-400">
            No orders are currently waiting for a delivery partner.
          </p>
        ) : (
          <div className="space-y-3">
            {waitingOrders.map((order) => (
              <WaitingOrderRow key={order._id} order={order} onAssigned={load} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Assignment history</h2>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s || 'All statuses'}
              </option>
            ))}
          </select>
        </div>
        {loading ? (
          <p className="mt-4 text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-gray-200 bg-surface">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
                <tr>
                  <th className="px-4 py-2">Order</th>
                  <th className="px-4 py-2">Rider</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Offered</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assignments.map((a) => (
                  <tr key={a._id}>
                    <td className="px-4 py-2.5 text-gray-700">{a.order?.orderNumber}</td>
                    <td className="px-4 py-2.5 text-gray-700">{a.deliveryPartner?.fullName}</td>
                    <td className="px-4 py-2.5"><Badge value={a.status} /></td>
                    <td className="px-4 py-2.5 text-gray-500">{new Date(a.offeredAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      {ACTIVE_STATUSES.includes(a.status) && (
                        <button type="button" onClick={() => setCancelling(a._id)} className="text-xs font-medium text-red-600 hover:underline">
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {assignments.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No assignments found.</p>}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={!!cancelling}
        title="Cancel this delivery assignment?"
        description="The order will need to be redispatched to another rider."
        confirmLabel="Cancel assignment"
        onConfirm={confirmCancel}
        onCancel={() => setCancelling(null)}
      />
    </div>
  );
}
