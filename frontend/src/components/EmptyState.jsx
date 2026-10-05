import AnimatedFood from './food/AnimatedFood';

// `food` (e.g. "burger") swaps the plain lucide `icon` for an animated mascot —
// opt-in, so every existing call site that only passes `icon` is unaffected.
// Interactive by default here specifically: an empty-cart/empty-search mascot
// is a deliberate, isolated moment where inviting a hover/click is a nice
// touch, unlike the purely decorative (non-interactive) uses elsewhere.
export default function EmptyState({ icon: Icon, food, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      {food ? (
        <AnimatedFood type={food} size="lg" interactive label={title} className="mb-1" />
      ) : (
        Icon && <Icon size={40} className="text-gray-300" />
      )}
      <p className="font-medium text-gray-700">{title}</p>
      {description && <p className="max-w-sm text-sm text-gray-400">{description}</p>}
      {action}
    </div>
  );
}
