import { useState } from 'react';

// M16 — mirrors the presets the backend accepts (backend/src/utils/dateRange.js).
// Keeping the values identical means the UI can never ask for a window the API
// will reject.
export const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7days', label: 'Last 7 days' },
  { value: 'last30days', label: 'Last 30 days' },
  { value: 'thismonth', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'alltime', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
];

export const DEFAULT_RANGE = { preset: 'last30days' };

// `value` is the params object sent straight to the API: { preset } or
// { preset: 'custom', startDate, endDate }. A custom range is only committed
// once BOTH ends are filled in, so a half-typed range never fires a request the
// server would 400 — and the local validation message explains why rather than
// waiting for that round trip.
export default function DateRangePicker({ value, onChange, disabled }) {
  const [startDate, setStartDate] = useState(value.startDate || '');
  const [endDate, setEndDate] = useState(value.endDate || '');

  const isCustom = value.preset === 'custom';
  const bothEnds = Boolean(startDate && endDate);
  const invalidOrder = bothEnds && startDate > endDate;

  function selectPreset(preset) {
    if (preset === 'custom') {
      // Don't fire yet — wait for both ends.
      onChange({ preset: 'custom', ...(startDate && endDate && startDate <= endDate ? { startDate, endDate } : {}) });
      return;
    }
    onChange({ preset });
  }

  function commitCustom(nextStart, nextEnd) {
    setStartDate(nextStart);
    setEndDate(nextEnd);
    if (nextStart && nextEnd && nextStart <= nextEnd) {
      onChange({ preset: 'custom', startDate: nextStart, endDate: nextEnd });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={value.preset || 'last30days'}
        disabled={disabled}
        onChange={(e) => selectPreset(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
        aria-label="Date range"
      >
        {PRESETS.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      {isCustom && (
        <>
          <input
            type="date"
            value={startDate}
            disabled={disabled}
            onChange={(e) => commitCustom(e.target.value, endDate)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
            aria-label="Start date"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={endDate}
            disabled={disabled}
            onChange={(e) => commitCustom(startDate, e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50"
            aria-label="End date"
          />
          {invalidOrder && <span className="text-xs font-medium text-red-600">Start date must be on or before the end date.</span>}
          {!bothEnds && !invalidOrder && <span className="text-xs text-gray-400">Pick both dates to apply.</span>}
        </>
      )}
    </div>
  );
}
