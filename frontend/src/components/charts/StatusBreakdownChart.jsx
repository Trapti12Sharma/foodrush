import { useState } from 'react';
import { ORDER_STATUS_LABELS } from '../OrderStatusBadge';

// Reserved status semantics (never reused as generic categorical hues): a
// delivered order genuinely is a "good" outcome, cancelled/rejected genuinely
// "critical", pending genuinely needs attention ("warning"). The remaining
// active-fulfillment statuses are ordinary progress, so they get the neutral
// categorical slot-1 blue rather than borrowing a status color they don't earn.
const COLOR_BY_STATUS = {
  pending: '#fab219',
  confirmed: '#2a78d6',
  preparing: '#2a78d6',
  ready_for_pickup: '#2a78d6',
  out_for_delivery: '#2a78d6',
  delivered: '#0ca30c',
  cancelled: '#d03b3b',
  rejected: '#d03b3b',
};

const LEGEND = [
  { label: 'Needs attention', color: '#fab219' },
  { label: 'In progress', color: '#2a78d6' },
  { label: 'Delivered', color: '#0ca30c' },
  { label: 'Cancelled / rejected', color: '#d03b3b' },
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
