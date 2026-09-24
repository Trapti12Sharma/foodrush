import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { adminService } from '../../services/adminService';

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [filters, setFilters] = useState({ action: '', actorRole: '', entityType: '', entityId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);

  function load() {
    setLoading(true);
    const params = { page, limit: 20 };
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params[k] = v;
    });
    adminService
      .listAuditLogs(params)
      .then((res) => {
        setLogs(res.logs);
        setPagination(res.pagination);
      })
      .catch((err) => toast.error(err.message || 'Could not load audit logs'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters(e) {
    e.preventDefault();
    setPage(1);
    load();
  }

  async function viewDetail(id) {
    try {
      setDetail(await adminService.getAuditLog(id));
    } catch (err) {
      toast.error(err.message || 'Could not load log entry');
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Audit logs</h1>
      <p className="mt-1 text-xs text-gray-500">
        Append-only trail of security- and money-relevant staff actions. Anything credential-shaped in metadata is
        redacted before it is ever stored.
      </p>

      <form onSubmit={applyFilters} className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
        <input
          value={filters.action}
          onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
          placeholder="Action, e.g. refund.created"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input
          value={filters.actorRole}
          onChange={(e) => setFilters((f) => ({ ...f, actorRole: e.target.value }))}
          placeholder="Actor role"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input
          value={filters.entityType}
          onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))}
          placeholder="Entity type"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input
          value={filters.entityId}
          onChange={(e) => setFilters((f) => ({ ...f, entityId: e.target.value }))}
          placeholder="Entity id"
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <input type="date" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
        <input type="date" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm" />
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
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log) => (
                <tr key={log._id}>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-800">{log.action}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {log.actor?.name || <span className="text-gray-400">system</span>} <span className="text-gray-400">({log.actorRole || '—'})</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{log.entityType ? `${log.entityType} · ${log.entityId}` : '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{new Date(log.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button type="button" onClick={() => viewDetail(log._id)} className="text-xs font-medium text-brand-600 hover:underline">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No audit log entries found.</p>}
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

      {detail && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6" onClick={(e) => e.stopPropagation()}>
            <p className="font-mono text-sm text-gray-900">{detail.action}</p>
            <div className="mt-3 space-y-1 text-sm text-gray-700">
              <p><span className="text-gray-400">Actor:</span> {detail.actor?.name || 'system'} ({detail.actorRole || '—'})</p>
              <p><span className="text-gray-400">Entity:</span> {detail.entityType || '—'} {detail.entityId}</p>
              <p><span className="text-gray-400">IP:</span> {detail.ip || '—'}</p>
              <p><span className="text-gray-400">User agent:</span> {detail.userAgent || '—'}</p>
              <p><span className="text-gray-400">When:</span> {new Date(detail.createdAt).toLocaleString()}</p>
            </div>
            <p className="mb-1 mt-4 text-xs font-semibold uppercase text-gray-400">Metadata</p>
            <pre className="overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{JSON.stringify(detail.metadata, null, 2)}</pre>
            <button type="button" onClick={() => setDetail(null)} className="mt-6 w-full rounded-lg border border-gray-200 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
