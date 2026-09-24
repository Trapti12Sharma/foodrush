import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

const STATUS_OPTIONS = ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];
const PRIORITY_OPTIONS = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
const CATEGORY_OPTIONS = ['ORDER', 'PAYMENT', 'REFUND', 'DELIVERY', 'RESTAURANT', 'ACCOUNT', 'TECHNICAL', 'OTHER'];
// What PATCH .../status will actually accept from the ticket's current status —
// mirrors SUPPORT_TICKET_TRANSITIONS in backend/src/utils/constants.js, so the
// dropdown never offers a move the server will reject.
const NEXT_STATUS = {
  OPEN: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['WAITING_FOR_USER', 'RESOLVED', 'CLOSED'],
  WAITING_FOR_USER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

const STATUS_STYLES = {
  OPEN: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  WAITING_FOR_USER: 'bg-purple-100 text-purple-700',
  RESOLVED: 'bg-green-100 text-green-700',
  CLOSED: 'bg-gray-200 text-gray-600',
};
const PRIORITY_STYLES = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
};

function Badge({ value, styles }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[value] || 'bg-gray-100 text-gray-500'}`}>{value}</span>;
}

function TicketDetailModal({ ticketId, onClose, onChanged }) {
  const [ticket, setTicket] = useState(null);
  const [message, setMessage] = useState('');
  const [resolution, setResolution] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    adminService
      .getSupportTicket(ticketId)
      .then(setTicket)
      .catch((err) => toast.error(err.message || 'Could not load ticket'));
  }

  useEffect(load, [ticketId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action, ...args) {
    setBusy(true);
    try {
      await action(...args);
      load();
      onChanged();
    } catch (err) {
      toast.error(err.message || 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  if (!ticket) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-gray-100 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-gray-400">{ticket.ticketNumber} · {ticket.category} · from {ticket.createdBy?.name} ({ticket.createdByRole})</p>
              <h2 className="text-lg font-bold text-gray-900">{ticket.subject}</h2>
            </div>
            <div className="flex gap-1">
              <Badge value={ticket.status} styles={STATUS_STYLES} />
              <Badge value={ticket.priority} styles={PRIORITY_STYLES} />
            </div>
          </div>
          <p className="mt-2 text-sm text-gray-600">{ticket.description}</p>
          {ticket.order?.orderNumber && <p className="mt-1 text-xs text-gray-400">Order #{ticket.order.orderNumber}</p>}
          {ticket.restaurant?.name && <p className="text-xs text-gray-400">Restaurant: {ticket.restaurant.name}</p>}
          {ticket.assignedTo && <p className="mt-1 text-xs text-gray-500">Assigned to {ticket.assignedTo.name}</p>}
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {(ticket.messages || []).map((m) => (
            <div key={m._id} className={`rounded-lg p-3 text-sm ${m.senderRole !== ticket.createdByRole ? 'bg-brand-50' : 'bg-gray-50'}`}>
              <p className="mb-1 text-xs font-semibold text-gray-500">{m.sender?.name || m.senderRole} · {new Date(m.createdAt).toLocaleString()}</p>
              <p className="text-gray-800">{m.message}</p>
            </div>
          ))}
          {(ticket.messages || []).length === 0 && <p className="text-center text-xs text-gray-400">No replies yet.</p>}
        </div>

        <div className="space-y-3 border-t border-gray-100 p-4">
          {ticket.status !== 'CLOSED' && (
            <div className="flex gap-2">
              <input
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Reply as support…"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={busy || !message.trim()}
                onClick={() => run(async () => { await adminService.addSupportTicketMessage(ticket._id, { message: message.trim() }); setMessage(''); })}
                className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Reply
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-gray-400">Status:</span>
            {(NEXT_STATUS[ticket.status] || []).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => run(adminService.updateSupportTicketStatus, ticket._id, s)}
                className="rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                → {s}
              </button>
            ))}

            <span className="ml-4 text-xs font-semibold uppercase text-gray-400">Priority:</span>
            <select
              value={ticket.priority}
              disabled={busy}
              onChange={(e) => run(adminService.updateSupportTicketPriority, ticket._id, e.target.value)}
              className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          {ticket.status === 'IN_PROGRESS' || ticket.status === 'WAITING_FOR_USER' ? (
            <div className="flex gap-2">
              <input
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Resolution note (optional)"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => { await adminService.resolveSupportTicket(ticket._id, resolution.trim() || undefined); setResolution(''); })}
                className="rounded-lg border border-green-200 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
              >
                Mark resolved
              </button>
            </div>
          ) : null}

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase text-gray-400">Assign to (staff user id):</span>
            <input
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              placeholder="User id"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => run(async () => { await adminService.assignSupportTicket(ticket._id, assigneeId.trim()); setAssigneeId(''); })}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Assign
            </button>
            {ticket.assignedTo && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(adminService.assignSupportTicket, ticket._id, '')}
                className="text-xs text-gray-400 hover:underline"
              >
                Unassign
              </button>
            )}
          </div>
        </div>

        <button type="button" onClick={onClose} className="border-t border-gray-100 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Close panel
        </button>
      </div>
    </div>
  );
}

export default function SupportTickets() {
  const [tickets, setTickets] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ status: '', priority: '', category: '', role: '', search: '', orderNumber: '' });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  function load() {
    setLoading(true);
    const params = { page, limit: 20 };
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params[k] = v;
    });
    adminService
      .listSupportTickets(params)
      .then((res) => {
        setTickets(res.tickets);
        setPagination(res.pagination);
      })
      .catch((err) => toast.error(err.message || 'Could not load support tickets'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters(e) {
    e.preventDefault();
    setPage(1);
    load();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Support tickets</h1>

      <form onSubmit={applyFilters} className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All priorities</option>
          {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filters.category} onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))} placeholder="Created-by role" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <input value={filters.search} onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))} placeholder="Ticket # or subject" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <input value={filters.orderNumber} onChange={(e) => setFilters((f) => ({ ...f, orderNumber: e.target.value }))} placeholder="Order number" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <button type="submit" className="col-span-2 rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 sm:col-span-1">
          Filter
        </button>
      </form>

      {loading ? (
        <p className="mt-4 text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 text-left text-xs uppercase text-gray-400">
              <tr>
                <th className="px-4 py-2">Ticket</th>
                <th className="px-4 py-2">From</th>
                <th className="px-4 py-2">Category</th>
                <th className="px-4 py-2">Priority</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Assigned</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tickets.map((t) => (
                <tr key={t._id}>
                  <td className="px-4 py-2.5">
                    <p className="text-xs text-gray-400">{t.ticketNumber}</p>
                    <p className="font-medium text-gray-800">{t.subject}</p>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">{t.createdBy?.name} <span className="text-gray-400">({t.createdByRole})</span></td>
                  <td className="px-4 py-2.5 text-gray-600">{t.category}</td>
                  <td className="px-4 py-2.5"><Badge value={t.priority} styles={PRIORITY_STYLES} /></td>
                  <td className="px-4 py-2.5"><Badge value={t.status} styles={STATUS_STYLES} /></td>
                  <td className="px-4 py-2.5 text-gray-500">{t.assignedTo?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => setOpenId(t._id)} className="text-xs font-medium text-brand-600 hover:underline">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tickets.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No support tickets found.</p>}
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40">
            Prev
          </button>
          <span className="text-gray-500">Page {pagination.page} of {pagination.totalPages}</span>
          <button type="button" disabled={page >= pagination.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-lg border border-gray-200 px-3 py-1 disabled:opacity-40">
            Next
          </button>
        </div>
      )}

      {openId && <TicketDetailModal ticketId={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
