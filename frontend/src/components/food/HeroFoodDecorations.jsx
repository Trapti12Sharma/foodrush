import AnimatedFood from './AnimatedFood';
import Sparkle from './Sparkle';

// A floating food background for one hero section. Pulled out of Home.jsx into
// its own component specifically so it stays data-driven (one array, mapped),
// rather than a hand-written pile of near-duplicate <AnimatedFood> tags that
// drifts out of sync item by item.
//
// SAFETY MODEL FOR "NEVER COVERS THE TEXT": every item's vertical inset is
// small (top-1..top-7 / bottom-1..bottom-7, i.e. <=1.75rem) and anchored to the
// SECTION's own edge padding (py-20 sm:py-24 on Home.jsx's content column is
// 80-96px), not to the viewport center. The hero's heading/search column is
// only width-constrained (max-w-4xl) above the `lg` breakpoint — below it, the
// text runs nearly full width — so horizontal position is NOT a safe way to
// dodge it at every screen size, but staying inside that top/bottom padding
// band vertically is: the text's own bounding box only exists *between* that
// padding, never inside it, regardless of viewport width.
//
// A first pass placed two desktop-only items at ~40% from each edge, sized
// `md` — technically still inside that safe vertical band, but visually they
// crowded the headline/search bar anyway (close to center reads as "in the
// way" well before it's close enough to literally overlap). Fixed by pulling
// every item further out toward its edge (max ~32% in) and back down to `sm`.
// "Never overlaps" and "doesn't feel cluttered" turned out to be two
// different bars to clear, not one.
//
// Three depth layers via opacity+size: background (small, faint, desktop-only,
// no glow — it should recede, not compete), middle, foreground (the four
// always-visible corner anchors, which also get the `glow` halo since they're
// the most prominent and benefit most from reading as "lit" rather than
// "pasted on"). Counts land in the requested ranges: 4 on mobile, 6 from `sm`,
// 10 from `lg`.
const ITEMS = [
  // --- Foreground layer: always visible, every breakpoint (4 on mobile) ---
  { type: 'drink', size: 'sm', pos: 'left-3 top-4', opacity: 'opacity-85', duration: '9s', delay: '-2s', glow: true },
  { type: 'pizza', size: 'sm', pos: 'right-3 top-4', opacity: 'opacity-85', duration: '10s', delay: '0s', glow: true },
  { type: 'burger', size: 'sm', pos: 'left-3 bottom-4', opacity: 'opacity-80', duration: '8s', delay: '-3s', glow: true },
  { type: 'fries', size: 'sm', pos: 'right-3 bottom-4', opacity: 'opacity-80', duration: '7s', delay: '-1s', glow: true },

  // --- Middle layer: from `sm` up (+2 => 6 on tablet) ---
  { type: 'donut', size: 'sm', pos: 'left-[18%] top-2', opacity: 'opacity-65', duration: '7s', delay: '-5s', glow: true, from: 'sm' },
  { type: 'dessert', size: 'sm', pos: 'right-[18%] bottom-2', opacity: 'opacity-65', duration: '9s', delay: '-4s', glow: true, from: 'sm' },

  // --- Background + extra middle layer: from `lg` up (+4 => 10 on desktop).
  // Kept small, faint and pulled in only as far as ~32% — never the ~40%
  // the first version used — specifically so nothing reads as hovering
  // next to the headline or search bar. ---
  { type: 'pizza', size: 'sm', pos: 'left-[9%] top-7', opacity: 'opacity-40', duration: '11s', delay: '-6s', from: 'lg' },
  { type: 'burger', size: 'sm', pos: 'right-[9%] bottom-7', opacity: 'opacity-40', duration: '8.5s', delay: '-2.5s', from: 'lg' },
  { type: 'drink', size: 'sm', pos: 'left-[30%] top-1', opacity: 'opacity-45', duration: '9.5s', delay: '-3.5s', from: 'lg' },
  { type: 'fries', size: 'sm', pos: 'right-[30%] bottom-1', opacity: 'opacity-45', duration: '7.5s', delay: '-1.5s', from: 'lg' },
];

// Scattered twinkles — present at every breakpoint like the foreground food
// layer is, so mobile gets "more animation" too, not just desktop.
const SPARKLES = [
  { size: 10, color: '#e9d5ff', pos: 'left-14 top-3', duration: '2.4s', delay: '-0.6s' },
  { size: 8, color: '#fde68a', pos: 'right-16 top-9', duration: '2.8s', delay: '-1.4s' },
  { size: 9, color: '#fbcfe8', pos: 'left-16 bottom-9', duration: '2.6s', delay: '-2s', from: 'sm' },
  { size: 10, color: '#bae6fd', pos: 'right-14 bottom-3', duration: '3s', delay: '-0.3s' },
  { size: 7, color: '#ffffff', pos: 'left-[26%] top-7', duration: '2.2s', delay: '-1.1s', from: 'lg' },
  { size: 8, color: '#ffffff', pos: 'right-[26%] bottom-7', duration: '2.5s', delay: '-1.8s', from: 'lg' },
];

const BREAKPOINT_HIDE = { sm: 'hidden sm:block', lg: 'hidden lg:block' };

export default function HeroFoodDecorations() {
  return (
    // z-[1]: above the plain glow-blob background (auto/0) but the hero's
    // actual content div sets z-10, so this still paints underneath it
    // regardless of DOM order (belt-and-braces alongside the DOM-order
    // stacking that already achieves the same thing on its own).
    // pointer-events-none on the group so the empty space between mascots can
    // never intercept a click meant for the page; each item re-enables
    // `interactive`, which sets its own pointer-events-auto back (see
    // AnimatedFood) so hover/click still work on the mascots themselves.
    <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden="true">
      {ITEMS.map((item, i) => (
        <AnimatedFood
          key={i}
          type={item.type}
          size={item.size}
          interactive
          performanceHint
          glow={item.glow}
          duration={item.duration}
          delay={item.delay}
          className={`absolute ${item.pos} ${item.opacity} ${item.from ? BREAKPOINT_HIDE[item.from] : ''}`}
        />
      ))}
      {SPARKLES.map((s, i) => (
        <Sparkle
          key={i}
          size={s.size}
          color={s.color}
          duration={s.duration}
          delay={s.delay}
          className={`${s.pos} ${s.from ? BREAKPOINT_HIDE[s.from] : ''}`}
        />
      ))}
    </div>
  );
}
