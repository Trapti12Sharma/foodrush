// A tiny four-point twinkle — the small white/pink star accents scattered
// around the mascots in the kawaii reference art, built as its own minimal
// component rather than folded into AnimatedFood: a sparkle isn't a food, has
// no idle-loop/hover/click/image-swap behaviour, and doesn't need any of
// AnimatedFood's machinery — it's one shape with one animation.
//
// Pure CSS (`animate-food-twinkle`: scale+rotate+opacity, GPU-friendly,
// respects prefers-reduced-motion via the same `data-food-anim` rule every
// other piece of this family uses — see index.css) and no JS animation loop.
export default function Sparkle({ size = 14, color = '#ffffff', duration, delay, className = '' }) {
  return (
    <span
      data-food-anim
      aria-hidden="true"
      className={`pointer-events-none absolute animate-food-twinkle ${className}`}
      style={{ width: size, height: size, animationDuration: duration, animationDelay: delay }}
    >
      <svg viewBox="0 0 24 24" className="h-full w-full" style={{ filter: `drop-shadow(0 0 3px ${color}aa)` }}>
        <path d="M12 0 L14.5 9.5 L24 12 L14.5 14.5 L12 24 L9.5 14.5 L0 12 L9.5 9.5 Z" fill={color} />
      </svg>
    </span>
  );
}
