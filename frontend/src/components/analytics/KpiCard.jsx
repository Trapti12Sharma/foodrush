// M16 — one KPI tile.
//
// The `value == null` case matters: the analytics API deliberately returns null
// rather than 0 for a rate or average it cannot compute (no orders to divide by,
// no delivery carrying both timestamps). Rendering that as "0%" would be a lie,
// so a null renders as "No data" in muted type instead. A genuine zero — ₹0 of
// sales in a quiet week — still renders as ₹0, because that IS the answer.
export default function KpiCard({ icon: Icon, label, value, hint, tone = 'default' }) {
  const hasValue = value !== null && value !== undefined;

  const valueTone = {
    default: 'text-gray-900',
    positive: 'text-green-700',
    negative: 'text-red-600',
  }[tone];

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-center gap-2 text-gray-400">
        {Icon && <Icon size={16} />}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      {hasValue ? (
        <p className={`mt-2 text-2xl font-bold ${valueTone}`}>{value}</p>
      ) : (
        <p className="mt-2 text-sm font-medium text-gray-400">No data</p>
      )}
      {hint && hasValue && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
