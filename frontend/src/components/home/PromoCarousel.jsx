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

export default function PromoCarousel() {
  return (
    <div className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-1 snap-x snap-mandatory sm:mx-0 sm:px-0 sm:pb-0">
      {CARDS.map(({ to, icon: Icon, title, desc, from, to2 }, i) => (
        <Link
          key={title}
          to={to}
          style={{ transitionDelay: `${i * 80}ms` }}
          className={`group flex w-[85%] shrink-0 snap-start items-center justify-between gap-3 rounded-xl bg-gradient-to-r ${from} ${to2} px-6 py-5 text-white shadow-sm transition-all duration-300 hover:shadow-lg hover:shadow-black/30 sm:w-auto sm:flex-1`}
        >
          <div className="flex items-center gap-3">
            <Icon size={22} className="transition-transform duration-300 group-hover:scale-110 group-hover:rotate-6" />
            <div>
              <p className="font-semibold">{title}</p>
              <p className="text-sm text-white/75">{desc}</p>
            </div>
          </div>
          <span className="shrink-0 text-sm font-medium underline opacity-0 transition-opacity duration-300 group-hover:opacity-100 sm:opacity-100">
            View
          </span>
        </Link>
      ))}
    </div>
  );
}
