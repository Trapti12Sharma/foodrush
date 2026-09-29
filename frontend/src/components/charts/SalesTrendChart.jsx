import { useState } from 'react';

// M16 — net sales per day as an area+line, with orders per day as faint bars
// behind it. Hand-rolled SVG on purpose: the project has no chart library and
// the next milestone is a performance pass, so adding ~100 kB gzipped to an
// already-641 kB bundle to draw one line would be working against it. Follows
// the same palette and interaction pattern as OrdersTrendChart.
const LINE_COLOR = '#2a78d6';
const AREA_COLOR = 'rgba(42, 120, 214, 0.12)';
const BAR_COLOR = '#e1e0d9';
const GRIDLINE = '#e1e0d9';
const AXIS_TEXT = '#898781';

function formatMoney(value) {
  if (Math.abs(value) >= 100000) return `₹${(value / 100000).toFixed(1)}L`;
  if (Math.abs(value) >= 1000) return `₹${(value / 1000).toFixed(1)}k`;
  return `₹${Math.round(value)}`;
}

function formatDay(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export default function SalesTrendChart({ data }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!data || data.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">No data available for this range.</p>;
  }

  const width = 640;
  const height = 200;
  const paddingLeft = 44;
  const paddingRight = 10;
  const paddingTop = 16;
  const paddingBottom = 26;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const maxNet = Math.max(...data.map((d) => d.net), 0);
  const maxOrders = Math.max(...data.map((d) => d.orders), 0);
  // Rounded up to a multiple of 4 so the 25/50/75% gridlines land on values
  // that can be labelled honestly (same reasoning as OrdersTrendChart).
  const niceMax = Math.max(Math.ceil(maxNet / 4) * 4, 4);

  // A single point would have no width to draw a line across, so the x step
  // falls back to the full plot rather than dividing by zero.
  const step = data.length > 1 ? plotWidth / (data.length - 1) : plotWidth;
  const slot = plotWidth / data.length;

  const pointAt = (index, value) => ({
    x: paddingLeft + (data.length > 1 ? index * step : plotWidth / 2),
    y: paddingTop + plotHeight * (1 - value / niceMax),
  });

  const points = data.map((d, i) => pointAt(i, d.net));
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${points[points.length - 1].x},${paddingTop + plotHeight} L${points[0].x},${paddingTop + plotHeight} Z`;

  // With many days, label only a handful of ticks so they never overlap.
  const labelEvery = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Net sales per day">
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = paddingTop + plotHeight * (1 - frac);
          return (
            <g key={frac}>
              <line x1={paddingLeft} y1={y} x2={width - paddingRight} y2={y} stroke={GRIDLINE} strokeWidth="1" />
              {(frac === 0 || frac === 0.5 || frac === 1) && (
                <text x={paddingLeft - 6} y={y + 3} textAnchor="end" fontSize="10" fill={AXIS_TEXT}>
                  {formatMoney(niceMax * frac)}
                </text>
              )}
            </g>
          );
        })}

        {/* Order counts as faint background bars — context for the money line,
            deliberately not a second labelled axis competing with it. */}
        {maxOrders > 0 &&
          data.map((d, i) => {
            const barHeight = (d.orders / Math.max(maxOrders, 1)) * plotHeight * 0.45;
            const barWidth = Math.min(18, slot * 0.5);
            return (
              <rect
                key={`bar-${d.date}`}
                x={paddingLeft + i * slot + (slot - barWidth) / 2}
                y={paddingTop + plotHeight - barHeight}
                width={barWidth}
                height={barHeight}
                fill={BAR_COLOR}
                rx="2"
              />
            );
          })}

        <path d={areaPath} fill={AREA_COLOR} />
        <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <circle
            key={`pt-${data[i].date}`}
            cx={p.x}
            cy={p.y}
            r={hoverIndex === i ? 4 : 2.5}
            fill={LINE_COLOR}
          />
        ))}

        {data.map((d, i) => (
          <g key={`hit-${d.date}`} onMouseEnter={() => setHoverIndex(i)} onMouseLeave={() => setHoverIndex(null)}>
            <rect x={paddingLeft + i * slot} y={paddingTop} width={slot} height={plotHeight} fill="transparent" />
            {i % labelEvery === 0 && (
              <text x={paddingLeft + i * slot + slot / 2} y={height - 6} textAnchor="middle" fontSize="10" fill={AXIS_TEXT}>
                {formatDay(d.date)}
              </text>
            )}
          </g>
        ))}
      </svg>

      {hoverIndex !== null && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
          style={{
            left: `${((paddingLeft + hoverIndex * slot + slot / 2) / width) * 100}%`,
            top: 0,
            transform: 'translate(-50%, -105%)',
          }}
        >
          <p className="font-semibold text-gray-900">₹{data[hoverIndex].net.toFixed(2)} net</p>
          <p className="text-gray-500">
            {data[hoverIndex].orders} order{data[hoverIndex].orders === 1 ? '' : 's'} · ₹{data[hoverIndex].gross.toFixed(2)} gross
          </p>
          {data[hoverIndex].refunds > 0 && <p className="text-red-600">−₹{data[hoverIndex].refunds.toFixed(2)} refunded</p>}
          <p className="text-gray-400">{formatDay(data[hoverIndex].date)}</p>
        </div>
      )}
    </div>
  );
}
