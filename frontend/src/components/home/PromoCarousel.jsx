import { Link } from 'react-router-dom';
import { Tag, Star, Sparkles } from 'lucide-react';

// Three real navigational shortcuts, not fabricated discount claims — each
// links to a route/filter combination the app already supports (Search's
// `hasOffer` flag, RestaurantListing's `sort`/`minRating`), so every card
// does exactly what it says rather than promising a specific % off that
// isn't backed by real data.
const CARDS = [
  {
    to: '/search?hasOffer=true',
    icon: Tag,
    title: 'Deals of the day',
    desc: 'Browse items with a live discount, across restaurants',
    from: 'from-brand-600',
    to2: 'to-brand-800',
  },
  {
    to: '/restaurants?sort=rating&minRating=4',
    icon: Star,
    title: 'Top rated near you',
    desc: '4★ and above, sorted by rating',
    from: 'from-amber-600',
    to2: 'to-orange-700',
  },
  {
    to: '/restaurants?sort=newest',
    icon: Sparkles,
    title: 'New on FoodRush',
    desc: 'Freshly listed restaurants worth trying',
    from: 'from-pink-600',
    to2: 'to-fuchsia-800',
  },
];

// Same design/colors/spacing as before, just given a fixed (not percentage)
// width so it behaves correctly inside the marquee track below, which sizes
// itself to its content (`w-max`) — a percentage width would be circular
// there (undefined against an auto-sized parent). Chosen so roughly 1.2
// cards show on a phone, ~2 on a tablet, ~3 on desktop, per spec.
const CARD_WIDTH = 'w-72 sm:w-80 lg:w-96';

// `duplicate` marks the second (visual-only) copy used to loop the marquee:
// hidden from screen readers and pulled out of tab order so keyboard/AT
// users only ever encounter each destination once, never a confusing
// double-listing of the same three cards.
function PromoCard({ to, icon: Icon, title, desc, from, to2, className = '', duplicate = false }) {
  return (
    <Link
      to={to}
      aria-label={`${title} — ${desc}`}
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
      className={`group flex shrink-0 items-center justify-between gap-3 rounded-xl bg-gradient-to-r ${from} ${to2} px-6 py-5 text-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-black/30 ${CARD_WIDTH} ${className}`}
    >
      <div className="flex items-center gap-3">
        <Icon size={22} className="shrink-0 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6" />
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-white/75">{desc}</p>
        </div>
      </div>
      {/* Plain span, not its own <a>/<button> — it sits inside the card's one
          Link, so clicking it fires exactly one navigation. Nesting a second
          interactive element in here would both double-handle the click and
          be invalid HTML (interactive-in-interactive). */}
      <span className="shrink-0 text-sm font-medium underline opacity-0 transition-opacity duration-300 group-hover:opacity-100 sm:opacity-100">
        View
      </span>
    </Link>
  );
}

// Mobile (below `sm`): the original native horizontal swipe/scroll-snap row,
// unanimated. A live `transform` marquee and a finger actively dragging the
// same element fight each other — the element's position becomes the sum of
// the animation's transform and the browser's scroll offset, which looks
// fine until release, when it visibly snaps. Keeping mobile as plain native
// scroll sidesteps that entirely, and satisfies "touch/swipe must work
// without requiring hover" trivially, since there's no animation to pause.
//
// `sm` and up: a continuous right-to-left marquee. CARDS renders twice back
// to back and the track animates translateX(0 → -50%) linear/infinite — since
// the second half is pixel-identical to the first, the loop point is
// invisible, which is what makes it seamless without any JS keeping time.
// The duplication is a UI-only repeat of a static local array (never
// fetched/DB data). Hovering the track — or focusing a card inside it via
// keyboard — pauses it; prefers-reduced-motion turns it off entirely via the
// shared [data-food-anim] gate already used across this app's animations.
export default function PromoCarousel() {
  return (
    <>
      <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1 snap-x snap-mandatory sm:hidden">
        {CARDS.map((c) => (
          <PromoCard key={c.title} {...c} className="snap-start" />
        ))}
      </div>

      <div className="hidden overflow-hidden sm:block">
        <div
          data-food-anim
          className="flex w-max animate-marquee gap-4 hover:[animation-play-state:paused] focus-within:[animation-play-state:paused]"
        >
          {[...CARDS, ...CARDS].map((c, i) => (
            <PromoCard key={`${c.title}-${i}`} {...c} duplicate={i >= CARDS.length} />
          ))}
        </div>
      </div>
    </>
  );
}
