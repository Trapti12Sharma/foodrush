import { Outlet, NavLink } from 'react-router-dom';
import { LayoutDashboard, BarChart3, Users, Store, ClipboardList, Tag, Bike, Navigation, Wallet, LifeBuoy, ScrollText, Star, SlidersHorizontal, UserCog } from 'lucide-react';
import NotificationBell from '../components/NotificationBell';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/restaurants', label: 'Restaurants', icon: Store },
  { to: '/admin/orders', label: 'Orders', icon: ClipboardList },
  { to: '/admin/reviews', label: 'Reviews', icon: Star },
  { to: '/admin/coupons', label: 'Coupons', icon: Tag },
  { to: '/admin/delivery-partners', label: 'Delivery partners', icon: Bike },
  { to: '/admin/delivery-assignments', label: 'Dispatch', icon: Navigation },
  { to: '/admin/delivery-settlements', label: 'Settlements', icon: Wallet },
  { to: '/admin/support-tickets', label: 'Support', icon: LifeBuoy },
  { to: '/admin/audit-logs', label: 'Audit logs', icon: ScrollText },
  // M17 — the two super-admin-only screens. `permission` is the permission the
  // endpoints behind the link actually require, so the sidebar shows a staff
  // member only what they can use instead of links that 403 on arrival. Hiding a
  // link is a convenience, never the boundary: the API re-checks on every call.
  { to: '/admin/staff', label: 'Team', icon: UserCog, permission: 'admins:manage' },
  { to: '/admin/settings', label: 'Settings', icon: SlidersHorizontal, permission: 'settings:manage' },
];

export default function AdminLayout() {
  const { user } = useAuth();
  // The backend puts the role's permission list on the user object (see
  // User.toJSON), so this filter uses the same table the API enforces rather than
  // a hardcoded role check that could drift from it.
  const permissions = user?.permissions || [];
  const navItems = NAV_ITEMS.filter((item) => !item.permission || permissions.includes(item.permission));

  return (
    <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
      <aside className="w-56 shrink-0 border-r border-gray-200 bg-white p-4">
        <p className="mb-4 text-sm font-semibold text-gray-900">Admin</p>
        <nav className="space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <div className="mb-4 flex justify-end">
          <NotificationBell />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
