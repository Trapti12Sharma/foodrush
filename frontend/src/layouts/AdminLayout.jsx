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

  // M19 — RESPONSIVE SIDEBAR. Below `md` the sidebar stops being a 224px column
  // (which on a 360px phone left roughly 40px for the actual page) and becomes a
  // horizontally-scrollable strip of the same links above the content. At `md`
  // and up the layout is byte-for-byte what it was: a fixed-width left column.
  //
  // A scrolling strip rather than a hamburger drawer on purpose — a drawer needs
  // open/close state, a backdrop, close-on-navigate, Escape handling and a focus
  // trap to be accessible, which is a lot of new surface for a nav that fits in a
  // strip. Every link stays reachable and nothing needs JavaScript. The same
  // three-line change is applied identically in the owner and delivery layouts.
  // FULL-BLEED SHELL. This used to be `mx-auto max-w-6xl`, which centers a
  // 1152px block regardless of viewport width — on anything wider than that
  // (any normal desktop monitor), the sidebar sat in the middle of the window
  // with a few hundred empty pixels on BOTH sides, and the content area's cards
  // stopped well short of the right edge too. A console the admin lives in all
  // day should use the window they gave it, not float in the middle of it.
  //
  // Sidebar is now a true flush-left column (own background, full height) and
  // the content area fills every remaining pixel, with padding only inside it.
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="w-full shrink-0 border-b border-gray-200 bg-surface p-4 md:w-56 md:border-b-0 md:border-r">
        <p className="mb-4 text-sm font-semibold text-gray-900">Admin</p>
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:block md:space-y-1 md:overflow-visible md:px-0">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2.5 text-sm font-medium md:py-2 ${
                  isActive ? 'bg-brand-50 text-brand-700' : 'text-gray-600 hover:bg-gray-50'
                }`
              }
            >
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mb-4 flex justify-end">
          <NotificationBell />
        </div>
        <Outlet />
      </div>
    </div>
  );
}
