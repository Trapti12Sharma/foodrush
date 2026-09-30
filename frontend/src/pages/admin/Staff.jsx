import { useEffect, useState } from 'react';
import toast from '@/utils/toast';
import { UserPlus, Mail, ShieldOff, Info } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useAuth } from '../../context/AuthContext';
import ConfirmDialog from '../../components/ConfirmDialog';

// M17 — the super-admin console (SUPER_ADMIN only).
//
// The screen mirrors the server's guards rather than discovering them through
// errors: a row for the signed-in user offers no role change and no revoke (the
// server refuses self-changes), and the permission each role carries is shown from
// the server's own matrix so nobody assigns a role expecting different powers.
//
// No password field anywhere, deliberately: creating an account emails the person
// a single-use link to set their own, and there is nothing here for an admin to
// see, choose or forward.

const ROLE_BLURBS = {
  SUPER_ADMIN: 'Everything, including platform settings and staff management.',
  ADMIN: 'Day-to-day marketplace operations. Cannot change settings or manage staff.',
  OPERATIONS_MANAGER: 'Reads users and restaurants; manages orders.',
  RESTAURANT_MANAGER: 'Approves and manages restaurants; moderates reviews.',
  DELIVERY_MANAGER: 'Delivery partners, dispatch and settlements.',
  SUPPORT_AGENT: 'Support tickets, plus read-only users and orders.',
};

function RoleBadge({ role }) {
  const tone = role === 'SUPER_ADMIN' ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-600';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{role}</span>;
}

function InviteForm({ roles, onCreated, onCancel }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'SUPPORT_AGENT' });
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const staff = await adminService.createStaff(form);
      toast.success(`${staff.name} was invited by email`);
      onCreated();
    } catch (err) {
      toast.error(err.errors?.[0]?.msg || err.message || 'Could not create the account');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-gray-200 bg-surface p-5">
      <h2 className="text-sm font-semibold text-gray-900">Invite a team member</h2>
      <p className="mt-1 text-xs text-gray-500">
        They receive an email with a single-use link to set their own password. You never see or choose it. The link lasts 7 days.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Name</span>
          <input
            required
            maxLength={100}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Email</span>
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Phone (optional)</span>
          <input
            maxLength={20}
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-700">Role</span>
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {r.role}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-xs text-gray-500">
        <Info size={14} className="mt-0.5 shrink-0" />
        {ROLE_BLURBS[form.role] || 'See the permission reference below for exactly what this role can do.'}
      </p>
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {busy ? 'Creating…' : 'Create and send invite'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function Staff() {
  const { user } = useAuth();
  const [matrix, setMatrix] = useState(null);
  const [items, setItems] = useState([]);
  const [filters, setFilters] = useState({ role: '', isActive: '', search: '' });
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [loading, setLoading] = useState(true);

  function loadStaff() {
    setLoading(true);
    const params = {};
    if (filters.role) params.role = filters.role;
    if (filters.isActive) params.isActive = filters.isActive;
    if (filters.search) params.search = filters.search;
    adminService
      .listStaff(params)
      .then((res) => setItems(res.items))
      .catch((err) => toast.error(err.message || 'Could not load staff'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    adminService
      .getRoleMatrix()
      .then(setMatrix)
      .catch((err) => toast.error(err.message || 'Could not load the role matrix'));
  }, []);

  useEffect(loadStaff, [filters.role, filters.isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  async function changeRole(member, role) {
    if (role === member.role) return;
    try {
      await adminService.updateStaffRole(member._id, role);
      toast.success(`${member.name} is now ${role}`);
      loadStaff();
    } catch (err) {
      // The server's message explains which guard fired (last super admin,
      // a restaurant owner that cannot be converted, and so on) — show it rather
      // than a generic failure, because the reason is the useful part.
      toast.error(err.message || 'Could not change the role');
      loadStaff();
    }
  }

  async function revoke(member) {
    try {
      await adminService.revokeStaff(member._id);
      toast.success(`${member.name} no longer has staff access`);
      loadStaff();
    } catch (err) {
      toast.error(err.message || 'Could not revoke access');
    } finally {
      setConfirm(null);
    }
  }

  async function resend(member) {
    try {
      await adminService.resendStaffInvite(member._id);
      toast.success(`A fresh invite was sent to ${member.email}`);
      loadStaff();
    } catch (err) {
      toast.error(err.message || 'Could not send the invite');
    }
  }

  const roles = matrix?.roles || [];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">Team</h1>
          <p className="mt-1 text-xs text-gray-500">Who works on FoodRush, and what each of them can do.</p>
        </div>
        {!inviting && (
          <button onClick={() => setInviting(true)} className="flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            <UserPlus size={15} /> Invite a team member
          </button>
        )}
      </header>

      {inviting && (
        <InviteForm
          roles={roles}
          onCancel={() => setInviting(false)}
          onCreated={() => {
            setInviting(false);
            loadStaff();
          }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">All roles</option>
          {roles.map((r) => (
            <option key={r.role} value={r.role}>
              {r.role}
            </option>
          ))}
        </select>
        <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value })} className="rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="">Any status</option>
          <option value="true">Active</option>
          <option value="false">Deactivated</option>
        </select>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadStaff();
          }}
          className="flex gap-2"
        >
          <input
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            placeholder="Name or email"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
          <button type="submit" className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
            Search
          </button>
        </form>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                  No staff accounts match these filters.
                </td>
              </tr>
            )}
            {!loading &&
              items.map((member) => {
                const isSelf = user && member._id === user._id;
                return (
                  <tr key={member._id}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {member.name}
                        {isSelf && <span className="ml-1.5 text-xs font-normal text-gray-400">(you)</span>}
                      </p>
                      <p className="text-xs text-gray-400">{member.email}</p>
                    </td>
                    <td className="px-4 py-3">
                      {/* A super admin cannot change their own role — the server
                          refuses it, so the control is not offered at all. */}
                      {isSelf ? (
                        <RoleBadge role={member.role} />
                      ) : (
                        <select
                          value={member.role}
                          onChange={(e) => changeRole(member, e.target.value)}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-xs"
                        >
                          {roles.map((r) => (
                            <option key={r.role} value={r.role}>
                              {r.role}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {/* An expired invite is called out separately from a
                          pending one: the first needs resending, the second only
                          needs waiting. An account created directly (bootstrap
                          or seed script) has a working password and no
                          outstanding invite, so it reads Active. */}
                      {!member.isActive ? (
                        <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs text-gray-600">Deactivated</span>
                      ) : member.inviteExpired ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">Invite expired</span>
                      ) : member.invitePending ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">Invite pending</span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        {member.isActive && (
                          <button onClick={() => resend(member)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-brand-700">
                            <Mail size={14} /> {member.invitePending ? 'Resend invite' : 'Send reset link'}
                          </button>
                        )}
                        {!isSelf && (
                          <button onClick={() => setConfirm(member)} className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-600">
                            <ShieldOff size={14} /> Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {matrix && (
        <section className="rounded-xl border border-gray-200 bg-surface p-5">
          <h2 className="text-sm font-semibold text-gray-900">What each role can do</h2>
          <p className="mt-1 text-xs text-gray-500">Served from the server&apos;s own permission table, so this is exactly what the API enforces.</p>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">Permission</th>
                  {roles.map((r) => (
                    <th key={r.role} className="px-2 py-2 text-center font-medium">
                      {r.role.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matrix.permissions.map((permission) => (
                  <tr key={permission}>
                    <td className="py-2 pr-4 font-mono text-gray-600">{permission}</td>
                    {roles.map((r) => (
                      <td key={r.role} className="px-2 py-2 text-center">
                        {r.permissions.includes(permission) ? <span className="text-green-600">●</span> : <span className="text-gray-200">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {confirm && (
        <ConfirmDialog
          open
          title={`Revoke staff access from ${confirm.name}?`}
          description="Their role drops to CUSTOMER and every staff permission goes with it, immediately. Their account and order history are kept — staff accounts are never deleted, because audit entries and moderation decisions reference them."
          confirmLabel="Revoke access"
          onConfirm={() => revoke(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
