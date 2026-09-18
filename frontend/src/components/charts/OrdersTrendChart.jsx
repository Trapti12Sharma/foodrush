import { useState } from 'react';

// Sequential blue (step 450 from the reference palette) — a single-series
// magnitude-over-time chart needs one hue, not a categorical set.
const BAR_COLOR = '#2a78d6';
const GRIDLINE = '#e1e0d9';
const AXIS_TEXT = '#898781';

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function OrdersTrendChart({ data }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const width = 560;
  const height = 180;
  const paddingLeft = 32;
  const paddingBottom = 24;
  const paddingTop = 16;
  const plotWidth = width - paddingLeft - 8;
  const plotHeight = height - paddingTop - paddingBottom;

  const max = Math.max(...data.map((d) => d.count), 1);
  // Round up to a multiple of 4 (not 5) so the 50%-height gridline lands on a
  // whole number too — a multiple of 5 can put the midpoint at an unlabelable
  // half-value (e.g. max=3 -> niceMax=5 -> midpoint=2.5, mislabeled as "3").
  const niceMax = Math.max(Math.ceil(max / 4) * 4, 4);
  const barSlot = plotWidth / data.length;
  const barWidth = Math.min(24, barSlot * 0.55);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Orders over the last 7 days">
        {[0, 0.5, 1].map((frac) => {
          const y = paddingTop + plotHeight * (1 - frac);
          return (
            <g key={frac}>
              <line x1={paddingLeft} y1={y} x2={width - 8} y2={y} stroke={GRIDLINE} strokeWidth="1" />
              <text x={paddingLeft - 6} y={y + 3} textAnchor="end" fontSize="10" fill={AXIS_TEXT}>
                {Math.round(niceMax * frac)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const barHeight = Math.max((d.count / niceMax) * plotHeight, d.count > 0 ? 2 : 0);
          const x = paddingLeft + i * barSlot + (barSlot - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const day = new Date(d.date + 'T00:00:00');

          return (
            <g key={d.date} onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)}>
              {/* Hit target wider than the visible bar, per interaction.md */}
              <rect x={paddingLeft + i * barSlot} y={paddingTop} width={barSlot} height={plotHeight} fill="transparent" />
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                fill={BAR_COLOR}
                opacity={hoverIndex === i ? 1 : 0.9}
                rx="4"
              />
              {/* Square off the bottom corners so rounding only shows at the data end */}
              {barHeight > 4 && <rect x={x} y={paddingTop + plotHeight - 4} width={barWidth} height="4" fill={BAR_COLOR} opacity={hoverIndex === i ? 1 : 0.9} />}
              <text x={paddingLeft + i * barSlot + barSlot / 2} y={height - 6} textAnchor="middle" fontSize="10" fill={AXIS_TEXT}>
                {WEEKDAY[day.getDay()]}
              </text>
            </g>
          );
        })}
      </svg>

      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${((paddingLeft + hoverIndex * barSlot + barSlot / 2) / width) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -110%)',
          }}
        >
          <p className="font-semibold text-gray-900">{data[hoverIndex].count} orders</p>
          <p className="text-gray-500">{new Date(data[hoverIndex].date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</p>
        </div>
      )}
    </div>
  );
}
