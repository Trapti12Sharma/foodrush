// M16 — one KPI tile.
//
// The `value == null` case matters: the analytics API deliberately returns null
// rather than 0 for a rate or average it cannot compute (no orders to divide by,
// no delivery carrying both timestamps). Rendering that as "0%" would be a lie,
// so a null renders as "No data" in muted type instead. A genuine zero — ₹0 of
// sales in a quiet week — still renders as ₹0, because that IS the answer.
//
// Presentation is a frosted-glass tile tinted by `accent`: a soft wash of that
// colour over the dark page, a matching border and icon chip, and a glow that
// strengthens on hover. Previously every card shared one neutral gray body and
// only a tiny icon differed between them, so a row of five metrics read as one
// shape repeated five times. The colour is still never the only signal — the
// label and value always say what the number means — but a quick glance at the
// row now tells "green things are going well, amber needs a look" before a
// single word is read.
const ACCENTS = {
  violet: {
    bg: 'from-brand-500/[0.14] to-brand-900/[0.04]',
    border: 'border-brand-500/25 hover:border-brand-500/45',
    glow: 'hover:shadow-brand-600/20',
    chip: 'bg-brand-500/25 text-brand-400',
    edge: 'from-brand-400',
  },
  blue: {
    bg: 'from-blue-500/[0.14] to-blue-900/[0.04]',
    border: 'border-blue-500/25 hover:border-blue-500/45',
    glow: 'hover:shadow-blue-600/20',
    chip: 'bg-blue-500/25 text-blue-300',
    edge: 'from-blue-400',
  },
  green: {
    bg: 'from-emerald-500/[0.14] to-emerald-900/[0.04]',
    border: 'border-emerald-500/25 hover:border-emerald-500/45',
    glow: 'hover:shadow-emerald-600/20',
    chip: 'bg-emerald-500/25 text-emerald-300',
    edge: 'from-emerald-400',
  },
  amber: {
    bg: 'from-amber-500/[0.14] to-amber-900/[0.04]',
    border: 'border-amber-500/25 hover:border-amber-500/45',
    glow: 'hover:shadow-amber-600/20',
    chip: 'bg-amber-500/25 text-amber-300',
    edge: 'from-amber-400',
  },
  rose: {
    bg: 'from-rose-500/[0.14] to-rose-900/[0.04]',
    border: 'border-rose-500/25 hover:border-rose-500/45',
    glow: 'hover:shadow-rose-600/20',
    chip: 'bg-rose-500/25 text-rose-300',
    edge: 'from-rose-400',
  },
  cyan: {
    bg: 'from-cyan-500/[0.14] to-cyan-900/[0.04]',
    border: 'border-cyan-500/25 hover:border-cyan-500/45',
    glow: 'hover:shadow-cyan-600/20',
    chip: 'bg-cyan-500/25 text-cyan-300',
    edge: 'from-cyan-400',
  },
};

export default function KpiCard({ icon: Icon, label, value, hint, tone = 'default', accent = 'violet' }) {
  const hasValue = value !== null && value !== undefined;

  const valueTone = {
    default: 'text-gray-900',
    positive: 'text-emerald-400',
    negative: 'text-rose-400',
  }[tone];

  const { bg, border, glow, chip, edge } = ACCENTS[accent] || ACCENTS.violet;

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${bg} ${border} p-4 shadow-lg shadow-black/20 backdrop-blur-xl transition duration-300 hover:shadow-xl ${glow}`}
    >
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${edge} to-transparent opacity-70`} aria-hidden="true" />
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
