// M16 — one KPI tile.
//
// The `value == null` case matters: the analytics API deliberately returns null
// rather than 0 for a rate or average it cannot compute (no orders to divide by,
// no delivery carrying both timestamps). Rendering that as "0%" would be a lie,
// so a null renders as "No data" in muted type instead. A genuine zero — ₹0 of
// sales in a quiet week — still renders as ₹0, because that IS the answer.
//
// Presentation is a frosted-glass tile: a translucent white wash over the dark
// page with a blurred backdrop, so the tiles read as layered panels rather than
// flat boxes. `accent` tints the icon chip and the card's top edge — purely
// decorative grouping, never the thing that carries the meaning (the label does).
const ACCENTS = {
  violet: { chip: 'bg-brand-600/20 text-brand-500', edge: 'from-brand-500/60' },
  blue: { chip: 'bg-blue-500/20 text-blue-300', edge: 'from-blue-400/60' },
  green: { chip: 'bg-emerald-500/20 text-emerald-300', edge: 'from-emerald-400/60' },
  amber: { chip: 'bg-amber-500/20 text-amber-300', edge: 'from-amber-400/60' },
  rose: { chip: 'bg-rose-500/20 text-rose-300', edge: 'from-rose-400/60' },
};

export default function KpiCard({ icon: Icon, label, value, hint, tone = 'default', accent = 'violet' }) {
  const hasValue = value !== null && value !== undefined;

  const valueTone = {
    default: 'text-gray-900',
    positive: 'text-emerald-400',
    negative: 'text-rose-400',
  }[tone];

  const { chip, edge } = ACCENTS[accent] || ACCENTS.violet;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-4 shadow-lg shadow-black/20 backdrop-blur-xl transition duration-300 hover:border-white/20 hover:shadow-xl">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${edge} to-transparent`} aria-hidden="true" />
      <div className="flex items-center gap-2">
        {Icon && (
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${chip}`}>
            <Icon size={15} />
          </span>
        )}
        <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
      </div>
      {hasValue ? (
        <p className={`mt-2.5 text-2xl font-bold ${valueTone}`}>{value}</p>
      ) : (
        <p className="mt-2.5 text-sm font-medium text-gray-400">No data</p>
      )}
      {hint && hasValue && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
