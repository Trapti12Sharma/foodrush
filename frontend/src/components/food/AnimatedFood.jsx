import { useEffect, useId, useRef, useState } from 'react';
import { FOOD_ICONS } from './icons';

const SIZE_PX = { sm: 48, md: 96, lg: 160 };

// Each type's idle loop and its decorative accent. The idle animation lives on
// the OUTER element; hover/click live on the INNER one (see below) — two
// separate elements, not two `animate-*` classes stacked on one, because the
// CSS `animation` shorthand doesn't merge when two utility classes both set
// it; nesting lets the transforms compose instead (outer translateY + inner
// scale both apply visually).
const IDLE_ANIMATION = {
  pizza: 'animate-food-float',
  burger: 'animate-food-bob',
  fries: 'animate-food-wiggle',
  drink: 'animate-food-bob',
  donut: 'animate-food-spin-slow',
  dessert: 'animate-food-bob',
};

// Soft color-matched backdrop behind each mascot, roughly matching its own
// palette (pizza/fries warm amber-red, burger golden, drink cyan, donut pink,
// dessert coral) — a flat icon dropped straight onto a dark gradient reads as
// a sticker pasted on top; a blurred glow the same hue underneath it is what
// makes it look like it belongs to the scene and is lit from within, rather
// than sitting flatly above it.
const GLOW_COLOR = {
  pizza: 'rgba(230,168,53,0.55)',
  burger: 'rgba(224,163,61,0.55)',
  fries: 'rgba(234,90,70,0.5)',
  drink: 'rgba(95,200,224,0.5)',
  donut: 'rgba(244,114,168,0.5)',
  dessert: 'rgba(232,115,74,0.5)',
};

// Small CSS-only accents layered around the mascot — steam, crumbs, bubbles —
// built from plain shapes (no extra image assets exist to slice into layers).
// Each one staggers its delay so a page with several mascots doesn't pulse in
// unison, which reads as mechanical rather than alive.
function Decor({ type, sizePx }) {
  const scale = sizePx / 96;
  if (type === 'pizza') {
    return (
      <span className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[0, 1].map((i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white/50 animate-food-steam"
            style={{
              width: 4 * scale, height: 10 * scale,
              left: `${38 + i * 14}%`, top: '8%',
              animationDelay: `${i * 0.9}s`,
            }}
          />
        ))}
      </span>
    );
  }
  if (type === 'burger') {
    return (
      <span className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute rounded-sm bg-amber-300 animate-food-crumb"
            style={{
              width: 3 * scale, height: 3 * scale,
              left: `${20 + i * 28}%`, bottom: '6%',
              animationDelay: `${i * 0.3}s`,
            }}
          />
        ))}
      </span>
    );
  }
  if (type === 'fries') {
    return (
      <span className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[0, 1].map((i) => (
          <span
            key={i}
            className="absolute rounded-full bg-amber-200 animate-food-pop"
            style={{
              width: 3 * scale, height: 3 * scale,
              left: `${30 + i * 32}%`, top: '14%',
              animationDelay: `${i * 0.6}s`,
            }}
          />
        ))}
      </span>
    );
  }
  if (type === 'drink') {
    return (
      <span className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white/70 animate-food-bubble"
            style={{
              width: 2.5 * scale, height: 2.5 * scale,
              left: `${35 + i * 10}%`, bottom: '18%',
              animationDelay: `${i * 0.5}s`,
            }}
          />
        ))}
        {/* condensation droplet — static placement, just a soft dot, no animation needed */}
        <span
          className="absolute rounded-full bg-white/40"
          style={{ width: 3 * scale, height: 4 * scale, left: '18%', top: '45%' }}
        />
      </span>
    );
  }
  if (type === 'donut' || type === 'dessert') {
    // Both read as "sweet/celebratory" rather than "hot" or "fizzy", so they
    // share a simple rising-sparkle accent instead of steam/bubbles/crumbs.
    return (
      <span className="pointer-events-none absolute inset-0" aria-hidden="true">
        {[0, 1].map((i) => (
          <span
            key={i}
            className="absolute rounded-full bg-white/60 animate-food-bubble"
            style={{
              width: 2.5 * scale, height: 2.5 * scale,
              left: `${25 + i * 45}%`, top: '10%',
              animationDelay: `${i * 0.7}s`,
            }}
          />
        ))}
      </span>
    );
  }
  return null;
}

/**
 * The one engine behind AnimatedPizza / AnimatedBurger / AnimatedFries /
 * AnimatedDrink. Renders a real image when given `src` (preserving
 * transparency — no background box is ever added around it), or an original
 * lightweight inline-SVG mascot otherwise (see ./icons.jsx).
 *
 *   <AnimatedFood type="pizza" size="md" />                 — built-in mascot
 *   <AnimatedFood type="pizza" src="/images/pizza.png" />   — your own asset, same animation
 *
 * @param {'pizza'|'burger'|'fries'|'drink'|'donut'|'dessert'} type
 * @param {string} [src] - real image URL; omit to use the built-in mascot
 * @param {'sm'|'md'|'lg'} [size='md']
 * @param {string} [animation] - overrides the type's default idle loop (any `animate-food-*` class suffix: float|bob|wiggle|pop)
 * @param {boolean} [interactive=false] - adds hover (scale+tilt+brightness+glow) and click (bounce); when false the element is pointer-events-none so it can never sit between a visitor and a real control
 * @param {boolean} [decorate] - small steam/crumb/bubble accents; defaults to true for md/lg, false for sm (too small to read)
 * @param {boolean} [eager=false] - skip lazy-loading (only for an above-the-fold `src` image)
 * @param {string} [label] - accessible name; omitted (decorative/aria-hidden) by default since these mascots are almost always flavour, not content
 * @param {string} [duration] - overrides the idle loop's default timing, e.g. "9s" — lets a group of mascots (see HeroFoodDecorations) drift at visibly different speeds instead of all breathing in lockstep
 * @param {string} [delay] - animation-delay, e.g. "-2s" (negative = starts partway through its cycle, so it isn't lockstep with others of the same duration either)
 * @param {boolean} [performanceHint=false] - adds `will-change: transform`; opt-in rather than automatic because promoting every small EmptyState/NotFound mascot to its own compositor layer app-wide would cost more memory than it's worth — reserved for spots like a hero background that keep several of these animating continuously at once
 * @param {boolean} [glow=false] - a soft blurred halo in the mascot's own colour, behind it — makes a small icon read as "glowing on a dark background" rather than "sticker pasted on top"; opt-in because it looks wrong against a light/white background (most non-hero uses)
 * @param {() => void} [onClick]
 */
export default function AnimatedFood({
  type,
  src,
  size = 'md',
  animation,
  interactive = false,
  decorate,
  eager = false,
  label,
  duration,
  delay,
  performanceHint = false,
  glow = false,
  className = '',
  onClick,
}) {
  const Icon = FOOD_ICONS[type];
  // Namespaces each mascot's internal SVG <linearGradient> ids (see icons.jsx)
  // so two mascots of the same type on one page — e.g. the hero's pizza and a
  // pizza elsewhere — don't collide over the same gradient id; SVG ids are
  // global to the document, not scoped to their own <svg>.
  // React's useId() includes colons (e.g. ":r0:"), which are legal in an SVG
  // id attribute but risky inside a url(#...) fragment reference across
  // browsers — stripped so the gradient ids in icons.jsx are plain alphanumerics.
  const uid = useId().replace(/:/g, '');
  const sizePx = SIZE_PX[size] || SIZE_PX.md;
  const shouldDecorate = decorate ?? size !== 'sm';
  const idleClass = animation ? `animate-food-${animation}` : IDLE_ANIMATION[type] || 'animate-food-float';

  // One-shot click bounce — NOT a loop. A click restarts the same CSS
  // animation (toggled off, then back on one frame later so the browser
  // actually registers the restart) and clears itself afterward via
  // onAnimationEnd, with a timeout as a backstop for the case where
  // prefers-reduced-motion has suppressed the animation entirely (so
  // onAnimationEnd would otherwise never fire and the state would stick).
  const [bouncing, setBouncing] = useState(false);
  const timeoutRef = useRef(null);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  function handleClick(e) {
    if (interactive) {
      setBouncing(false);
      requestAnimationFrame(() => setBouncing(true));
      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setBouncing(false), 600);
    }
    onClick?.(e);
  }

  if (!Icon && !src) return null;

  return (
    // OUTER span: a bare positioning passthrough, entirely owned by the
    // caller's `className` (e.g. "absolute right-10 top-10 ..."). It
    // contributes NO classes of its own — specifically never `relative`,
    // which used to live here and silently beat a caller's `absolute` in the
    // cascade (Tailwind's generated stylesheet defines `.absolute` before
    // `.relative`, so equal-specificity single-class selectors resolved to
    // `.relative` regardless of source order in the className string —
    // verified directly against the compiled CSS, not assumed). That bug is
    // why hero mascots given different corners both collapsed into normal
    // document flow at the top-left instead. Sizing/animation/decoration now
    // live one level in, on an element the caller's className can never touch.
    <span className={className}>
      <span
        data-food-anim
        className={`relative inline-block select-none ${idleClass} ${performanceHint ? 'will-change-transform' : ''} ${
          // Defensive, not redundant: a decorative group (HeroFoodDecorations)
          // wraps everything in one pointer-events-none container so the gaps
          // between mascots never intercept a click meant for the page behind
          // them. pointer-events is inherited, so without explicitly setting
          // `auto` here, an `interactive` item inside that container would
          // silently inherit `none` from its ancestor and stop responding to
          // hover/click despite this component asking for exactly that.
          interactive ? 'pointer-events-auto' : 'pointer-events-none'
        }`}
        style={{ width: sizePx, height: sizePx, animationDuration: duration, animationDelay: delay }}
        role={label ? 'img' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      >
        {glow && (
          <span
            className="pointer-events-none absolute -inset-[30%] -z-10 rounded-full blur-xl"
            style={{ background: `radial-gradient(circle, ${GLOW_COLOR[type] || 'rgba(192,132,252,0.5)'} 0%, transparent 70%)` }}
            aria-hidden="true"
          />
        )}
        <span
          className={`block h-full w-full origin-center transition-[transform,filter] duration-300 ease-out ${
            interactive
              ? 'cursor-pointer hover:-rotate-6 hover:scale-110 hover:brightness-110 hover:drop-shadow-[0_0_14px_rgba(192,132,252,0.5)] active:scale-95'
              : ''
          } ${bouncing ? 'animate-food-click-bounce' : ''}`}
          onClick={interactive ? handleClick : undefined}
          onAnimationEnd={() => setBouncing(false)}
        >
          {src ? (
            <img
              src={src}
              alt={label || ''}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              draggable={false}
              className="h-full w-full object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.35)]"
            />
          ) : (
            <Icon uid={uid} className="h-full w-full drop-shadow-[0_8px_16px_rgba(0,0,0,0.35)]" />
          )}
        </span>
        {shouldDecorate && <Decor type={type} sizePx={sizePx} />}
      </span>
    </span>
  );
}
