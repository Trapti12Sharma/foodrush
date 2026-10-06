/** @type {import('tailwindcss').Config} */

// DARK THEME BY TOKEN OVERRIDE.
//
// The app is styled almost entirely through three families of utilities:
// `bg-surface` (cards/panels), the `gray` scale (page background, borders and
// text) and the `brand` scale (accents). Rather than rewrite ~60 component
// files, the dark theme is produced by redefining those scales here:
//
//   * `gray` is INVERTED in lightness — gray-50..300 become dark surfaces and
//     borders, gray-400..900 become progressively lighter text. So an existing
//     `text-gray-900` heading turns white, `text-gray-500` turns muted lavender
//     and `border-gray-200` turns into a dark divider, with no markup changes.
//   * `brand` is likewise inverted at the light end — brand-50..300 are dark
//     purple fills (so `bg-brand-50` chips read as tinted panels, not glaring
//     white), while brand-400..700 stay vivid so they remain legible ON those
//     dark fills and as buttons.
//
// `white` is deliberately left untouched: ~64 `text-white` usages sit on
// coloured buttons/badges and must stay white. Card backgrounds use the
// separate `surface` token instead of `bg-white` for exactly this reason.
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Card / panel backgrounds (replaces every former `bg-white`).
        surface: {
          DEFAULT: '#1f1936',
          raised: '#2a2344',
        },
        brand: {
          50: '#1b1030',
          100: '#261644',
          200: '#33205c',
          300: '#4a2d80',
          400: '#d8b4fe',
          500: '#c084fc',
          600: '#9333ea',
          700: '#a855f7',
          800: '#7e22ce',
          900: '#581c87',
        },
        gray: {
          50: '#141020',
          100: '#231c3b',
          200: '#373052',
          300: '#4f4675',
          400: '#a196bb',
          500: '#bcb2d2',
          600: '#d2cae2',
          700: '#e6e1f0',
          800: '#f4f1fa',
          900: '#ffffff',
        },
        // Warm accent kept for the few places that should read hot/urgent
        // against all the purple (deal glows, discount flashes).
        accent: {
          50: '#2a1508',
          100: '#3d1e0b',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
        },
      },
      // Idle micro-animations for the AnimatedFood component family
      // (src/components/food/). Pure transform/opacity — no layout-affecting
      // properties — so these stay on the GPU compositor and never trigger
      // reflow. `prefers-reduced-motion` is handled centrally in index.css
      // (forces `animation: none` on anything carrying `data-food-anim`)
      // rather than per-keyframe here, so one rule covers all of them.
      keyframes: {
        'food-float': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-10px) rotate(-3deg)' },
        },
        'food-bob': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-7px)' },
        },
        'food-wiggle': {
          '0%, 100%': { transform: 'rotate(-2deg)' },
          '50%': { transform: 'rotate(2deg)' },
        },
        'food-pop': {
          '0%, 60%, 100%': { transform: 'translateY(0)' },
          '30%': { transform: 'translateY(-14px)' },
        },
        'food-click-bounce': {
          '0%': { transform: 'scale(1)' },
          '30%': { transform: 'scale(0.9)' },
          '55%': { transform: 'scale(1.12)' },
          '75%': { transform: 'scale(0.97)' },
          '100%': { transform: 'scale(1)' },
        },
        'food-steam': {
          '0%': { transform: 'translateY(0) scaleX(1)', opacity: '0.35' },
          '50%': { transform: 'translateY(-8px) scaleX(1.4)', opacity: '0.15' },
          '100%': { transform: 'translateY(-16px) scaleX(1)', opacity: '0' },
        },
        'food-bubble': {
          '0%': { transform: 'translateY(0)', opacity: '0' },
          '20%': { opacity: '0.8' },
          '100%': { transform: 'translateY(-22px)', opacity: '0' },
        },
        'food-crumb': {
          '0%, 100%': { transform: 'translate(0, 0) rotate(0deg)', opacity: '0.7' },
          '50%': { transform: 'translate(3px, -5px) rotate(20deg)', opacity: '1' },
        },
        // A lazy full rotation, distinct from float/wiggle's small back-and-forth
        // tilt — used for the donut, since a donut slowly turning end-over-end
        // reads naturally where a pizza slice doing the same would not.
        'food-spin-slow': {
          '0%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-6px) rotate(180deg)' },
          '100%': { transform: 'translateY(0) rotate(360deg)' },
        },
        // Twinkle for the new Sparkle accent (see components/food/Sparkle.jsx) —
        // scale+opacity only, never adds a third animated property, so it stays
        // as cheap as the rest of this family.
        'food-twinkle': {
          '0%, 100%': { transform: 'scale(0.4) rotate(0deg)', opacity: '0' },
          '50%': { transform: 'scale(1) rotate(45deg)', opacity: '1' },
        },
        // Continuous right-to-left scroll for the promo carousel track (see
        // components/home/PromoCarousel.jsx), which renders its card list
        // twice back to back — looping exactly at -50% is therefore seamless,
        // since the second copy is already sitting where the first started.
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
      },
      animation: {
        'food-float': 'food-float 4.5s ease-in-out infinite',
        'food-bob': 'food-bob 3.2s ease-in-out infinite',
        'food-wiggle': 'food-wiggle 2.4s ease-in-out infinite',
        'food-pop': 'food-pop 2.8s ease-in-out infinite',
        'food-click-bounce': 'food-click-bounce 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 1',
        'food-steam': 'food-steam 3s ease-out infinite',
        'food-bubble': 'food-bubble 2.4s ease-in infinite',
        'food-crumb': 'food-crumb 1.8s ease-in-out infinite',
        'food-spin-slow': 'food-spin-slow 7s linear infinite',
        'food-twinkle': 'food-twinkle 2.2s ease-in-out infinite',
        // 26s: within the spec's suggested 20-30s range, linear for a
        // constant (not easing in/out) scroll speed.
        marquee: 'marquee 26s linear infinite',
      },
    },
  },
  plugins: [],
};
