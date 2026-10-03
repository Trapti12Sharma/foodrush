import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { adminService } from '../../services/adminService';
import Pagination from '../../components/Pagination';

const PAGE_SIZE = 10;

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
        <div className="mt-6 overflow-hidden rounded-2xl border border-brand-300/20 shadow-xl shadow-black/30">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user._id}>
                    <td className="font-semibold text-gray-900">{user.name}</td>
                    <td>{user.email}</td>
                    <td>{user.role}</td>
                    <td>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${user.isActive
                          ? 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30'
                          : 'bg-white/10 text-gray-500 ring-white/15'
                          }`}
                      >
                        {user.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="text-right">
                      <button
                        type="button"
                        disabled={busyId === user._id}
                        onClick={() => toggleActive(user)}
                        className={user.isActive ? 'table-action-btn-danger' : 'table-action-btn-success'}
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
