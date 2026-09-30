import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { adminService } from '../../services/adminService';
import ConfirmDialog from '../../components/ConfirmDialog';

const SETTLEMENT_STYLES = {
  PENDING: 'bg-amber-100 text-amber-700',
  APPROVED: 'bg-blue-100 text-blue-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  PAID: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-200 text-gray-600',
};
const STATUS_FILTERS = ['', 'PENDING', 'APPROVED', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED'];

function Badge({ value }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${SETTLEMENT_STYLES[value] || 'bg-gray-100 text-gray-500'}`}>{value}</span>;
}

function GenerateSettlementForm({ onGenerated }) {
  const [riders, setRiders] = useState([]);
  const [deliveryPartnerId, setDeliveryPartnerId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    adminService
      .listDeliveryPartners({ accountStatus: 'ACTIVE', limit: 100 })
      .then((res) => setRiders(res.deliveryPartners))
      .catch(() => setRiders([]));
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!deliveryPartnerId || !periodStart || !periodEnd) return;
    setSubmitting(true);
    try {
      await adminService.generateDeliverySettlement({ deliveryPartnerId, periodStart, periodEnd });
      toast.success('Settlement generated');
      setPeriodStart('');
      setPeriodEnd('');
      onGenerated();
    } catch (err) {
      toast.error(err.message || 'Could not generate settlement');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 rounded-xl border border-gray-200 bg-surface p-4 sm:grid-cols-4">
      <select
        value={deliveryPartnerId}
        onChange={(e) => setDeliveryPartnerId(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="">Select rider…</option>
        {riders.map((r) => (
          <option key={r._id} value={r._id}>
            {r.fullName} ({r.user?.email})
          </option>
        ))}
      </select>
      <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" />
      <button
        type="submit"
        disabled={submitting || !deliveryPartnerId || !periodStart || !periodEnd}
        className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? 'Generating…' : 'Generate settlement'}
      </button>
    </form>
  );
}

export default function DeliverySettlements() {
  const [settlements, setSettlements] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [failing, setFailing] = useState(null);
  const [failReason, setFailReason] = useState('');
  const [payingId, setPayingId] = useState(null);
  const [payoutReference, setPayoutReference] = useState('');

  function load() {
    setLoading(true);
    adminService
      .listDeliverySettlements({ status: statusFilter || undefined, limit: 50 })
      .then((res) => setSettlements(res.settlements))
      .catch((err) => toast.error(err.message || 'Could not load settlements'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [statusFilter]);

  async function viewDetail(id) {
    try {
      setDetail(await adminService.getDeliverySettlement(id));
    } catch (err) {
      toast.error(err.message || 'Could not load settlement details');
    }
  }

  async function approve(id) {
    setBusyId(id);
    try {
      await adminService.approveDeliverySettlement(id);
      toast.success('Settlement approved');
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message || 'Could not approve settlement');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmMarkPaid() {
    const id = payingId;
    setBusyId(id);
    try {
      await adminService.markDeliverySettlementPaid(id, { payoutReference });
      toast.success('Settlement marked paid');
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message || 'Could not mark settlement paid');
    } finally {
      setBusyId(null);
      setPayingId(null);
      setPayoutReference('');
    }
  }

  async function confirmMarkFailed() {
    const id = failing;
    setBusyId(id);
    try {
      await adminService.markDeliverySettlementFailed(id, failReason);
      toast.success('Settlement marked failed');
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message || 'Could not mark settlement failed');
    } finally {
      setBusyId(null);
      setFailing(null);
      setFailReason('');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Delivery settlements</h1>
      <p className="mt-1 text-xs text-gray-500">
        Internal payout records only — marking a settlement paid records that an admin confirmed payment by some other means
        (bank transfer, cash, UPI). No real payout gateway is connected in this milestone.
      </p>

      <div className="mt-6">
        <GenerateSettlementForm onGenerated={load} />
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Settlements</h2>
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
                <th className="px-4 py-2">Rider</th>
                <th className="px-4 py-2">Period</th>
                <th className="px-4 py-2">Deliveries</th>
                <th className="px-4 py-2">Net amount</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {settlements.map((s) => (
                <tr key={s._id}>
                  <td className="px-4 py-2.5 text-gray-700">{s.deliveryPartner?.fullName}</td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {new Date(s.periodStart).toLocaleDateString()} – {new Date(s.periodEnd).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-2.5 text-gray-700">{s.deliveryCount}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-900">₹{s.netAmount.toFixed(2)}</td>
                  <td className="px-4 py-2.5"><Badge value={s.status} /></td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => viewDetail(s._id)} className="text-xs font-medium text-brand-600 hover:underline">
                        View
                      </button>
                      {s.status === 'PENDING' && (
                        <button type="button" disabled={busyId === s._id} onClick={() => approve(s._id)} className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-50">
                          Approve
                        </button>
                      )}
                      {s.status === 'APPROVED' && (
                        <>
                          <button type="button" disabled={busyId === s._id} onClick={() => setPayingId(s._id)} className="text-xs font-medium text-green-700 hover:underline disabled:opacity-50">
                            Mark Paid
                          </button>
                          <button type="button" disabled={busyId === s._id} onClick={() => setFailing(s._id)} className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50">
                            Mark Failed
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {settlements.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No settlements found.</p>}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">{detail.settlement.deliveryPartner?.fullName}</h2>
            <div className="mt-1"><Badge value={detail.settlement.status} /></div>
            <div className="mt-3 space-y-1 text-sm text-gray-700">
              <p><span className="text-gray-400">Period:</span> {new Date(detail.settlement.periodStart).toLocaleDateString()} – {new Date(detail.settlement.periodEnd).toLocaleDateString()}</p>
              <p><span className="text-gray-400">Deliveries:</span> {detail.settlement.deliveryCount}</p>
              <p><span className="text-gray-400">Gross:</span> ₹{detail.settlement.grossAmount.toFixed(2)}</p>
              <p><span className="text-gray-400">Deductions:</span> ₹{detail.settlement.deductions.toFixed(2)}</p>
              <p><span className="text-gray-400">Net:</span> ₹{detail.settlement.netAmount.toFixed(2)}</p>
              {detail.settlement.approvedAt && <p><span className="text-gray-400">Approved:</span> {new Date(detail.settlement.approvedAt).toLocaleString()}</p>}
              {detail.settlement.paidAt && <p><span className="text-gray-400">Paid:</span> {new Date(detail.settlement.paidAt).toLocaleString()}</p>}
              {detail.settlement.payoutReference && <p><span className="text-gray-400">Payout reference:</span> {detail.settlement.payoutReference}</p>}
              {detail.settlement.failureReason && <p className="text-red-600"><span className="text-gray-400">Failure reason:</span> {detail.settlement.failureReason}</p>}
            </div>

            <p className="mb-2 mt-4 text-sm font-semibold text-gray-700">Included deliveries</p>
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
              {detail.earnings.map((e) => (
                <div key={e._id} className="flex justify-between px-3 py-2 text-xs">
                  <span>#{e.orderNumber}</span>
                  <span>₹{e.netAmount.toFixed(2)}</span>
                </div>
              ))}
            </div>

            <button type="button" onClick={() => setDetail(null)} className="mt-6 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!payingId}
        title="Mark this settlement as paid?"
        description={
          <input
            value={payoutReference}
            onChange={(e) => setPayoutReference(e.target.value)}
            placeholder="Payout reference / note (optional)"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        }
        confirmLabel="Mark paid"
        onConfirm={confirmMarkPaid}
        onCancel={() => {
          setPayingId(null);
          setPayoutReference('');
        }}
      />
      <ConfirmDialog
        open={!!failing}
        title="Mark this settlement as failed?"
        description={
          <input
            value={failReason}
            onChange={(e) => setFailReason(e.target.value)}
            placeholder="Reason (optional)"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        }
        confirmLabel="Mark failed"
        onConfirm={confirmMarkFailed}
        onCancel={() => {
          setFailing(null);
          setFailReason('');
        }}
      />
    </div>
  );
}
