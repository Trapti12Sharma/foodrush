import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import useDismissable from '../hooks/useDismissable';
import NotificationPanel, { destinationFor } from './NotificationPanel';

// Mounted once in each authenticated layout's header (Navbar, AdminLayout,
// DeliveryPartnerLayout, RestaurantOwnerLayout) — a single small, reusable
// component rather than each layout reimplementing its own bell/dropdown.
export default function NotificationBell() {
  const { user } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  // Replaces the full-screen invisible backdrop this used to render. That
  // backdrop closed the panel, but it also swallowed the click — so the first
  // click on anything else only dismissed the menu instead of pressing it.
  const panelRef = useDismissable(open, () => setOpen(false), { closeOnLeave: true, leaveDelayMs: 400 });

  async function handleSelect(notification) {
    setOpen(false);
    if (!notification.readAt) {
      try {
        await markAsRead(notification._id);
      } catch {
        // Non-fatal — the notification still navigates even if marking it read failed.
      }
    }
    const destination = destinationFor(notification, user?.role);
    if (destination) navigate(destination);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="absolute right-0 z-40 mt-2 w-80 rounded-lg border border-gray-200 bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
              <p className="text-sm font-semibold text-gray-900">Notifications</p>
              {unreadCount > 0 && (
                <button type="button" onClick={() => markAllAsRead()} className="text-xs font-medium text-brand-600 hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            <NotificationPanel notifications={notifications} onSelect={handleSelect} />
          </div>
        </>
      )}
    </div>
  );
}
