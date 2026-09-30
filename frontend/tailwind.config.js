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
    },
  },
  plugins: [],
};
