// Translucent tint + bright text, rather than the old pastel-fill + dark-text
// chips. On a dark page a solid `bg-*-100` block reads as a glaring sticker;
// a tinted pill with a matching border sits in the design instead of on top of it.
const STYLES = {
  PLACED: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
  CONFIRMED: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
  PREPARING: 'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
  READY_FOR_PICKUP: 'bg-brand-500/15 text-brand-500 ring-1 ring-brand-500/30',
  OUT_FOR_DELIVERY: 'bg-brand-500/15 text-brand-500 ring-1 ring-brand-500/30',
  DELIVERED: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  CANCELLED: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  REJECTED: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/30',
  REFUND_PENDING: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
  REFUNDED: 'bg-white/10 text-gray-500 ring-1 ring-white/15',
};

export const ORDER_STATUS_LABELS = {
  PLACED: 'Placed',
  CONFIRMED: 'Confirmed',
  PREPARING: 'Preparing',
  READY_FOR_PICKUP: 'Ready for pickup',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
};

export default function OrderStatusBadge({ status }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status] || 'bg-white/10 text-gray-500 ring-1 ring-white/15'}`}>
      {ORDER_STATUS_LABELS[status] || status}
    </span>
  );
}
