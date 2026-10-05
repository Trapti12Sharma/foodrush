// Original, minimal flat-SVG mascots — one per food type — used ONLY as a
// fallback when AnimatedFood is given no `src`. No local image assets exist
// anywhere in this project yet (src/assets and public/ are both empty; this
// app sources all real food photos from Cloudinary URLs stored per-item in
// the database, via SmartImage — never bundled files), so these exist purely
// so the animated-food feature has something honest to show today. The moment
// a real asset file is added, passing `src="/images/pizza.png"` to
// AnimatedFood swaps straight to it — nothing else about the API changes.
//
// Deliberately simple (a handful of flat shapes + one friendly face, now with
// soft gradients rather than flat fills for a less sticker-like finish), not a
// pixel-for-pixel copy of any reference art — same "rounded, friendly" spirit,
// drawn from scratch as inline SVG so there's no extra network request and no
// licensing question.
//
// `uid` namespaces every <linearGradient> id (e.g. "pizza-crust-x7k2") so two
// mascots of the same type on one page don't silently share (and fight over)
// the same gradient definition — SVG ids are global to the document, not
// scoped to the <svg> they're defined in. AnimatedFood passes its own React
// useId() through as this.
const FACE = (
  <>
    <circle cx="-9" cy="2" r="2.6" fill="#2d2240" />
    <circle cx="9" cy="2" r="2.6" fill="#2d2240" />
    <path d="M -7 9 Q 0 14.5 7 9" stroke="#2d2240" strokeWidth="2.4" strokeLinecap="round" fill="none" />
    {/* a touch of blush — reads as "happy", not just "neutral face slapped on" */}
    <ellipse cx="-15" cy="6" rx="3" ry="2" fill="#f4968a" opacity="0.35" />
    <ellipse cx="15" cy="6" rx="3" ry="2" fill="#f4968a" opacity="0.35" />
  </>
);

export function PizzaIcon({ uid, ...props }) {
  const crust = `pizza-crust-${uid}`;
  const cheese = `pizza-cheese-${uid}`;
  return (
    <svg viewBox="-50 -50 100 100" {...props}>
      <defs>
        <linearGradient id={crust} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6c35f" />
          <stop offset="1" stopColor="#e2a835" />
        </linearGradient>
        <linearGradient id={cheese} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#ffcf5c" />
        </linearGradient>
      </defs>
      <path d="M -40 -34 L 40 -34 L 4 41 Q 0 47 -4 41 Z" fill={`url(#${crust})`} stroke="#c9860f" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M -30 -25 L 30 -25 L 3 31 Q 0 36 -3 31 Z" fill={`url(#${cheese})`} />
      {/* crust rim highlight, so the crust reads as puffy bread not a flat triangle border */}
      <path d="M -38 -32 L 38 -32" stroke="#ffe3a3" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <circle cx="-10" cy="-9" r="5.5" fill="#d64545" />
      <circle cx="12" cy="-3" r="5" fill="#d64545" />
      <circle cx="-2" cy="13" r="4.5" fill="#d64545" />
      <circle cx="8" cy="21" r="3.5" fill="#d64545" />
      <circle cx="-10" cy="-9" r="2" fill="#b53636" opacity="0.5" />
      <circle cx="12" cy="-3" r="1.8" fill="#b53636" opacity="0.5" />
      <g transform="translate(0, 11)">{FACE}</g>
    </svg>
  );
}

export function BurgerIcon({ uid, ...props }) {
  const bun = `burger-bun-${uid}`;
  return (
    <svg viewBox="-50 -50 100 100" {...props}>
      <defs>
        <linearGradient id={bun} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0b35a" />
          <stop offset="1" stopColor="#d98f2e" />
        </linearGradient>
      </defs>
      <path d="M -36 -18 Q -37 -41 0 -41 Q 37 -41 36 -18 Z" fill={`url(#${bun})`} stroke="#b8781f" strokeWidth="2.5" />
      <path d="M -30 -27 Q 0 -37 30 -27" stroke="#ffdf9e" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.55" />
      <circle cx="-14" cy="-30" r="2" fill="#fff3d6" />
      <circle cx="4" cy="-33" r="2" fill="#fff3d6" />
      <circle cx="18" cy="-27" r="2" fill="#fff3d6" />
      <rect x="-38" y="-16" width="76" height="8" rx="3" fill="#6fae3e" />
      <rect x="-38" y="-7" width="76" height="9" rx="2" fill="#d6472c" />
      <rect x="-38" y="3" width="76" height="9" rx="2" fill="#f2c230" />
      <path d="M -36 14 Q -36 30 0 30 Q 36 30 36 14 Z" fill="#e8a33d" stroke="#b8781f" strokeWidth="2.5" />
      <g transform="translate(0, 2)">{FACE}</g>
    </svg>
  );
}

export function FriesIcon({ uid, ...props }) {
  const box = `fries-box-${uid}`;
  return (
    <svg viewBox="-50 -50 100 100" {...props}>
      <defs>
        <linearGradient id={box} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ea5a46" />
          <stop offset="1" stopColor="#cc3f2d" />
        </linearGradient>
      </defs>
      <path d="M -26 -6 L 26 -6 L 20 42 Q 19 46 14 46 L -14 46 Q -19 46 -20 42 Z" fill={`url(#${box})`} stroke="#b5392c" strokeWidth="2.5" />
      <path d="M -22 2 L 22 2" stroke="#ffffff" strokeWidth="1.5" opacity="0.3" />
      <path d="M -22 -6 L -14 -34" stroke="#f9d27a" strokeWidth="7" strokeLinecap="round" />
      <path d="M -9 -6 L -9 -38" stroke="#f9d27a" strokeWidth="7" strokeLinecap="round" />
      <path d="M 4 -6 L 9 -36" stroke="#f9d27a" strokeWidth="7" strokeLinecap="round" />
      <path d="M 16 -6 L 22 -32" stroke="#f9d27a" strokeWidth="7" strokeLinecap="round" />
      {/* a hint of golden shading on each fry tip for depth */}
      <path d="M -17 -28 L -14 -34" stroke="#e8a830" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <path d="M -9 -32 L -9 -38" stroke="#e8a830" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <g transform="translate(0, 24)">{FACE}</g>
    </svg>
  );
}

export function DrinkIcon({ uid, ...props }) {
  const cup = `drink-cup-${uid}`;
  return (
    <svg viewBox="-50 -50 100 100" {...props}>
      <defs>
        <linearGradient id={cup} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9fe3f0" />
          <stop offset="1" stopColor="#5cb8cf" />
        </linearGradient>
      </defs>
      <path d="M -18 -30 L 18 -30 L 13 38 Q 12 44 6 44 L -6 44 Q -12 44 -13 38 Z" fill={`url(#${cup})`} stroke="#3fa6bd" strokeWidth="2.5" opacity="0.95" />
      <path d="M -14 -24 L 14 -24 L 10 10 L -10 10 Z" fill="#5a4330" opacity="0.88" />
      <path d="M -16 -29 L 16 -29" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
      <rect x="-5" y="-48" width="6" height="26" rx="3" fill="#fff" stroke="#d8d8d8" strokeWidth="1.5" transform="rotate(12)" />
      <circle cx="-6" cy="-2" r="3.5" fill="#fff" opacity="0.8" />
      <circle cx="5" cy="6" r="3" fill="#fff" opacity="0.7" />
      <g transform="translate(0, 24)">{FACE}</g>
    </svg>
  );
}

export function DonutIcon({ uid, ...props }) {
  const dough = `donut-dough-${uid}`;
  const icing = `donut-icing-${uid}`;
  // A torus drawn as two concentric stroked circles (thick tan ring, thinner
  // pink ring centered on it) rather than a filled path — the simplest way to
  // get a clean donut-with-a-hole cross-section, and the "hole" is just
  // genuine transparency, showing whatever is behind it exactly like a real
  // donut's hole would.
  const sprinkleAt = (angleDeg, color) => {
    const r = (angleDeg * Math.PI) / 180;
    const x = Math.cos(r) * 27;
    const y = Math.sin(r) * 27;
    return <rect key={angleDeg} x={x - 4} y={y - 1.3} width="8" height="2.6" rx="1.3" fill={color} transform={`rotate(${angleDeg + 40} ${x} ${y})`} />;
  };
  return (
    <svg viewBox="-50 -50 100 100" {...props}>
      <defs>
        <linearGradient id={dough} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0b35a" />
          <stop offset="1" stopColor="#d08a2e" />
        </linearGradient>
        <linearGradient id={icing} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff9fc7" />
          <stop offset="1" stopColor="#f472a8" />
        </linearGradient>
      </defs>
      <circle cx="0" cy="-2" r="27" fill="none" stroke={`url(#${dough})`} strokeWidth="20" />
      <circle cx="0" cy="-7" r="27" fill="none" stroke={`url(#${icing})`} strokeWidth="13" strokeDasharray="150 20" />
      {sprinkleAt(-150, '#5ec8e0')}
      {sprinkleAt(-115, '#9ee36b')}
      {sprinkleAt(-80, '#fff27a')}
      {sprinkleAt(-45, '#5ec8e0')}
      {sprinkleAt(-10, '#9ee36b')}
      <g transform="translate(0, 24)">{FACE}</g>
    </svg>
  );
}

export function DessertIcon({ uid, ...props }) {
  const liner = `dessert-liner-${uid}`;
  const frosting = `dessert-frosting-${uid}`;
  return (
    <svg viewBox="-50 -50 100 100" {...props}>
      <defs>
        <linearGradient id={liner} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8734a" />
          <stop offset="1" stopColor="#c8572f" />
        </linearGradient>
        <linearGradient id={frosting} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6ef" />
          <stop offset="1" stopColor="#ffe0d1" />
        </linearGradient>
      </defs>
      {/* fluted paper liner */}
      <path d="M -26 10 L -20 42 Q -18 46 -13 46 L 13 46 Q 18 46 20 42 L 26 10 Z" fill={`url(#${liner})`} stroke="#a8431f" strokeWidth="2.5" strokeLinejoin="round" />
      {[-15, -5, 5, 15].map((x) => (
        <path key={x} d={`M ${x - 3} 12 L ${x} 44`} stroke="#a8431f" strokeWidth="1.5" opacity="0.4" />
      ))}
      {/* swirled frosting — three overlapping rounded lobes read as a soft-serve swirl */}
      <circle cx="-9" cy="2" r="13" fill={`url(#${frosting})`} />
      <circle cx="9" cy="2" r="13" fill={`url(#${frosting})`} />
      <circle cx="0" cy="-10" r="15" fill={`url(#${frosting})`} />
      <circle cx="0" cy="-24" r="10" fill={`url(#${frosting})`} />
      {/* cherry on top */}
      <circle cx="0" cy="-34" r="5" fill="#d6384a" />
      <path d="M 1 -38 Q 4 -43 7 -41" stroke="#6fae3e" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <circle cx="-2" cy="-36" r="1.4" fill="#fff" opacity="0.6" />
      <g transform="translate(0, 24)">{FACE}</g>
    </svg>
  );
}

export const FOOD_ICONS = {
  pizza: PizzaIcon,
  burger: BurgerIcon,
  fries: FriesIcon,
  drink: DrinkIcon,
  donut: DonutIcon,
  dessert: DessertIcon,
};
