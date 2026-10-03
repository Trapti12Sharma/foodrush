import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { adminService } from '../../services/adminService';
import ConfirmDialog from '../../components/ConfirmDialog';
import Pagination from '../../components/Pagination';

const PAGE_SIZE = 10;
const KYC_FILTERS = ['', 'SUBMITTED', 'VERIFIED', 'REJECTED', 'PENDING'];
const ACCOUNT_FILTERS = ['', 'PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'];

const KYC_STYLES = {
  PENDING: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  SUBMITTED: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
  VERIFIED: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
};
const ACCOUNT_STYLES = {
  PENDING: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  ACTIVE: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  SUSPENDED: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
};

function Badge({ styles, value }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[value] || 'bg-white/10 text-gray-500 ring-1 ring-white/15'}`}>{value}</span>;
}

export default function DeliveryPartners() {
  const [partners, setPartners] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kycFilter, setKycFilter] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [accountFilter, setAccountFilter] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [suspending, setSuspending] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');

  function load() {
    setLoading(true);
    setLoadError(null);
    adminService
      .listDeliveryPartners({ search: search || undefined, kycStatus: kycFilter || undefined, accountStatus: accountFilter || undefined, page, limit: PAGE_SIZE })
      .then((res) => {
        setPartners(res.deliveryPartners || []);
        setPagination(res.pagination || null);
      })
      .catch((err) => {
        // A failed request used to leave `partners` at [] and render "No delivery
        // partners found." — telling an admin that nobody has applied when in
        // fact the server was never successfully asked. A rate-limit (429) or a
        // permissions error then looks identical to an empty queue.
        setPartners([]);
        setPagination(null);
        setLoadError(err.status === 429 ? 'Too many requests — the list will load again shortly.' : err.message || 'Could not load delivery partners');
        toast.error(err.message || 'Could not load delivery partners');
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [search, kycFilter, accountFilter, page]);
  useEffect(() => setPage(1), [search, kycFilter, accountFilter]);

  async function viewDetail(id) {
    try {
      setDetail(await adminService.getDeliveryPartner(id));
    } catch (err) {
      toast.error(err.message || 'Could not load details');
    }
  }

  async function approve(id) {
    setBusyId(id);
    try {
      await adminService.approveDeliveryPartnerKyc(id);
      toast.success('KYC approved — account activated');
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message || 'Could not approve KYC');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmReject() {
    const id = rejecting;
    setBusyId(id);
    try {
      await adminService.rejectDeliveryPartnerKyc(id, rejectReason);
      toast.success('KYC rejected');
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message || 'Could not reject KYC');
    } finally {
      setBusyId(null);
      setRejecting(null);
      setRejectReason('');
    }
  }

  async function confirmSuspend() {
    const id = suspending;
    setBusyId(id);
    try {
      await adminService.suspendDeliveryPartner(id, suspendReason);
      toast.success('Delivery partner suspended');
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message || 'Could not suspend delivery partner');
    } finally {
      setBusyId(null);
      setSuspending(null);
      setSuspendReason('');
    }
  }

  async function reactivate(id) {
    setBusyId(id);
    try {
      await adminService.reactivateDeliveryPartner(id);
      toast.success('Delivery partner reactivated');
      load();
      setDetail(null);
    } catch (err) {
      toast.error(err.message || 'Could not reactivate delivery partner');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Delivery partners</h1>
        <div className="flex flex-wrap gap-2">
          <select value={kycFilter} onChange={(e) => setKycFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            {KYC_FILTERS.map((f) => (
              <option key={f} value={f}>
                {f ? `KYC: ${f}` : 'All KYC'}
              </option>
            ))}
          </select>
          <select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm">
            {ACCOUNT_FILTERS.map((f) => (
              <option key={f} value={f}>
                {f ? `Account: ${f}` : 'All accounts'}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name/phone/vehicle…"
            className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
        </div>
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="mt-6 space-y-3">
          {partners.map((p) => (
            <div key={p._id} className="rounded-xl border border-gray-200 bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">{p.fullName}</p>
                  <p className="text-xs text-gray-400">
                    {p.city} · {p.vehicleType} {p.vehicleNumber ? `(${p.vehicleNumber})` : ''} · {p.user?.email}
                  </p>
                  <div className="mt-1 flex gap-2">
                    <Badge styles={KYC_STYLES} value={p.kycStatus} />
                    <Badge styles={ACCOUNT_STYLES} value={p.accountStatus} />
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => viewDetail(p._id)}
                    className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                  >
                    View
                  </button>
                  {p.kycStatus === 'SUBMITTED' && (
                    <>
                      <button
                        type="button"
                        disabled={busyId === p._id}
                        onClick={() => approve(p._id)}
                        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                      >
                        Approve KYC
                      </button>
                      <button
                        type="button"
                        disabled={busyId === p._id}
                        onClick={() => setRejecting(p._id)}
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        Reject KYC
                      </button>
                    </>
                  )}
                  {p.accountStatus === 'ACTIVE' && (
                    <button
                      type="button"
                      disabled={busyId === p._id}
                      onClick={() => setSuspending(p._id)}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      Suspend
                    </button>
                  )}
                  {p.accountStatus === 'SUSPENDED' && (
                    <button
                      type="button"
                      disabled={busyId === p._id}
                      onClick={() => reactivate(p._id)}
                      className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Reactivate
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {partners.length === 0 &&
            (loadError ? (
              <div className="p-6 text-center">
                <p className="text-sm font-medium text-red-400">{loadError}</p>
                <button
                  type="button"
                  onClick={load}
                  className="mt-3 rounded-lg border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Try again
                </button>
              </div>
            ) : (
              <p className="p-6 text-center text-sm text-gray-400">No delivery partners found.</p>
            ))}
          {pagination && pagination.totalPages > 1 && (
            <Pagination meta={pagination} onPageChange={setPage} />
          )}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">{detail.fullName}</h2>
            <p className="text-xs text-gray-400">{detail.user?.email} · {detail.phone}</p>
            <div className="mt-2 flex gap-2">
              <Badge styles={KYC_STYLES} value={detail.kycStatus} />
              <Badge styles={ACCOUNT_STYLES} value={detail.accountStatus} />
            </div>

            <div className="mt-4 space-y-1 text-sm text-gray-700">
              <p><span className="text-gray-400">Address:</span> {detail.address?.addressLine}, {detail.city} {detail.address?.pincode}</p>
              <p><span className="text-gray-400">Vehicle:</span> {detail.vehicleType} {detail.vehicleNumber}</p>
              <p><span className="text-gray-400">Licence:</span> {detail.drivingLicenceNumber || '—'}</p>
              {detail.dateOfBirth && <p><span className="text-gray-400">Date of birth:</span> {new Date(detail.dateOfBirth).toLocaleDateString()}</p>}
              {detail.kycRejectionReason && <p className="text-red-600"><span className="text-gray-400">Rejection reason:</span> {detail.kycRejectionReason}</p>}
              {detail.accountStatusReason && <p className="text-red-600"><span className="text-gray-400">Suspension reason:</span> {detail.accountStatusReason}</p>}
            </div>

            <div className="mt-4">
              <p className="mb-2 text-sm font-semibold text-gray-700">KYC documents</p>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(detail.documents || {}).filter(([, url]) => url).map(([key, url]) => (
                  <a key={key} href={url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-gray-200">
                    <img src={url} alt={key} className="h-24 w-full object-cover" />
                  </a>
                ))}
                {Object.values(detail.documents || {}).every((v) => !v) && <p className="text-xs text-gray-400">No documents uploaded.</p>}
              </div>
            </div>

            <button type="button" onClick={() => setDetail(null)} className="mt-6 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!rejecting}
        title="Reject this delivery partner's KYC?"
        description={
          <input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason (required)"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        }
        confirmLabel="Reject"
        onConfirm={confirmReject}
        onCancel={() => {
          setRejecting(null);
          setRejectReason('');
        }}
      />
      <ConfirmDialog
        open={!!suspending}
        title="Suspend this delivery partner?"
        description={
          <input
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Reason (optional)"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        }
        confirmLabel="Suspend"
        onConfirm={confirmSuspend}
        onCancel={() => {
          setSuspending(null);
          setSuspendReason('');
        }}
      />
    </div>
  );
}
