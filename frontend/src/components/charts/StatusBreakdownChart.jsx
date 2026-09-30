import { useState } from 'react';
import { ORDER_STATUS_LABELS } from '../OrderStatusBadge';

// Reserved status semantics (never reused as generic categorical hues): a
// delivered order genuinely is a "good" outcome, cancelled/rejected genuinely
// "critical", pending genuinely needs attention ("warning"). The remaining
// active-fulfillment statuses are ordinary progress, so they get the neutral
// categorical slot-1 blue rather than borrowing a status color they don't earn.
// Keys are the UPPERCASE ORDER_STATUS values the API actually returns. They were
// lowercase here (pending/confirmed/...), left over from before order statuses
// were uppercased and PLACED replaced PENDING, which meant every bar resolved to
// backgroundColor: undefined and rendered colourless — and REFUND_PENDING/
// REFUNDED had no entry at all. Refund states get their own amber-to-neutral
// treatment: money going back is not a fulfilment failure like a cancellation,
// but it is not a clean delivery either.
// Same semantics, brightened one step for the dark theme — the original
// mid-tones were mixed for white panels and read as muddy on a dark one.
const COLOR_BY_STATUS = {
  PLACED: '#fbbf24',
  CONFIRMED: '#60a5fa',
  PREPARING: '#60a5fa',
  READY_FOR_PICKUP: '#60a5fa',
  OUT_FOR_DELIVERY: '#60a5fa',
  DELIVERED: '#34d399',
  CANCELLED: '#f87171',
  REJECTED: '#f87171',
  REFUND_PENDING: '#d4a72c',
  REFUNDED: '#a99dc4',
};

const LEGEND = [
  { label: 'Needs attention', color: '#fbbf24' },
  { label: 'In progress', color: '#60a5fa' },
  { label: 'Delivered', color: '#34d399' },
  { label: 'Cancelled / rejected', color: '#f87171' },
  { label: 'Refunded', color: '#a99dc4' },
];

export default function StatusBreakdownChart({ data }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div>
      <div className="space-y-2">
        {data.map((d) => {
          const pct = (d.count / max) * 100;
          return (
            <div
              key={d.status}
              className="group flex items-center gap-3"
              onMouseEnter={() => setHovered(d.status)}
              onMouseLeave={() => setHovered(null)}
            >
              <span className="w-32 shrink-0 text-xs text-gray-600">{ORDER_STATUS_LABELS[d.status]}</span>
              <div className="relative h-4 flex-1 rounded bg-gray-100">
                <div
                  className="h-4 rounded-r"
                  style={{
                    width: `${Math.max(pct, d.count > 0 ? 2 : 0)}%`,
                    backgroundColor: COLOR_BY_STATUS[d.status],
                    opacity: hovered === d.status ? 1 : 0.9,
                    borderRadius: '4px',
                  }}
                />
              </div>
              <span className="w-8 shrink-0 text-right text-xs font-medium text-gray-700">{d.count}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
        {LEGEND.map((item) => (
          <span key={item.label} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
