import { Check } from 'lucide-react';

// Where clicking a notification should go — role-aware only where the
// underlying page itself is role-specific (support tickets, delivery/
// settlement info); every order/payment/refund-linked type reuses the same
// /orders/:id page every role already uses (the backend's canAccessOrder
// already authorizes the customer, the owning restaurant, and the assigned
// rider alike — see order.service.js).
const ORDER_LINKED_TYPES = new Set([
  'ORDER_PLACED', 'ORDER_CONFIRMED', 'ORDER_REJECTED', 'ORDER_CANCELLED', 'ORDER_READY', 'ORDER_OUT_FOR_DELIVERY', 'ORDER_DELIVERED',
  'PAYMENT_SUCCESS', 'PAYMENT_FAILED', 'PAYMENT_RETRY_REQUIRED',
  'REFUND_CREATED', 'REFUND_FAILED', 'REFUND_COMPLETED',
  'DELIVERY_REJECTED', 'DELIVERY_OTP_REQUIRED',
]);

export function destinationFor(notification, role) {
  const { type, data } = notification;
  if (data?.orderId && ORDER_LINKED_TYPES.has(type)) return `/orders/${data.orderId}`;
  if (type === 'DELIVERY_ASSIGNED' || type === 'DELIVERY_COMPLETED') return '/delivery/dashboard';
  if (type === 'DELIVERY_ACCEPTED' || type === 'DELIVERY_STARTED') return '/restaurant/orders';
  if (type?.startsWith('SUPPORT_TICKET_')) {
    if (role === 'DELIVERY_PARTNER') return '/delivery/support';
    if (role === 'RESTAURANT_OWNER') return '/restaurant/support';
    if (role && role !== 'CUSTOMER') return '/admin/support-tickets';
    return '/support';
  }
  if (type?.startsWith('SETTLEMENT_')) return '/delivery/dashboard';
  return null;
}

function timeAgo(dateStr) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Pure list rendering — used by NotificationBell's dropdown. Kept as its own
// component so a future full "all notifications" page can reuse it unchanged.
export default function NotificationPanel({ notifications, onSelect, emptyText = 'No notifications yet.' }) {
  if (notifications.length === 0) {
    return <p className="p-6 text-center text-sm text-gray-400">{emptyText}</p>;
  }

  return (
    <div className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
      {notifications.map((n) => (
        <button
          key={n._id}
          type="button"
          onClick={() => onSelect(n)}
          className={`flex w-full items-start gap-2 px-4 py-3 text-left text-sm hover:bg-gray-50 ${n.readAt ? '' : 'bg-brand-50/60'}`}
        >
          {!n.readAt && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />}
          <span className={`flex-1 ${n.readAt ? 'pl-3.5' : ''}`}>
            <span className="block font-medium text-gray-900">{n.title}</span>
            <span className="mt-0.5 block text-xs text-gray-500">{n.message}</span>
            <span className="mt-1 block text-[11px] text-gray-400">{timeAgo(n.createdAt)}</span>
          </span>
          {n.readAt && <Check size={14} className="mt-1 shrink-0 text-gray-300" />}
        </button>
      ))}
    </div>
  );
}
