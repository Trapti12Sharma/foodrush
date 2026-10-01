import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { adminService } from '../../services/adminService';
import Pagination from '../../components/Pagination';

const PAGE_SIZE = 20;

export default function Users() {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState(null);

  function load() {
    setLoading(true);
    adminService
      .listUsers({ search: search || undefined, page, limit: PAGE_SIZE })
      .then((res) => {
        setUsers(res.users);
        setPagination(res.pagination);
      })
      .catch((err) => toast.error(err.message || 'Could not load users'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [search, page]);
  // A new search term invalidates whatever page you were on — page 3 of an
  // unfiltered list is rarely page 3 of a filtered one.
  useEffect(() => setPage(1), [search]);

  async function toggleActive(user) {
    setBusyId(user._id);
    try {
      await adminService.setUserActive(user._id, !user.isActive);
      load();
    } catch (err) {
      toast.error(err.message || 'Could not update user');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Users</h1>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      {loading ? (
        <p className="mt-8 text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] shadow-lg shadow-black/20 backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.07]">
                {users.map((user) => (
                  <tr key={user._id} className="transition hover:bg-white/[0.04]">
                    <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                    <td className="px-4 py-3 text-gray-600">{user.email}</td>
                    <td className="px-4 py-3 text-gray-600">{user.role}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                          user.isActive
                            ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                            : 'bg-white/10 text-gray-500 ring-white/15'
                        }`}
                      >
                        {user.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        disabled={busyId === user._id}
                        onClick={() => toggleActive(user)}
                        className="text-xs font-medium text-brand-600 hover:underline disabled:opacity-50"
                      >
                        {user.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {users.length === 0 && <p className="p-6 text-center text-sm text-gray-400">No users found.</p>}
          <Pagination meta={pagination} onPageChange={setPage} />
        </div>
      )}
    </div>
  );
}
