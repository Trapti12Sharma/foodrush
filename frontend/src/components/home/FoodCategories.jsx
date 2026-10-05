import { Link } from 'react-router-dom';
import { FEATURED_CATEGORIES } from '../../constants/cuisines';

// A horizontally scroll-snapping row on mobile (where 8 items can't fit a
// 4-column grid without feeling cramped) that settles back into a plain grid
// from `sm` up, where there's room. Scrollbars are already hidden globally
// (see index.css), so the snap row reads as a clean swipeable strip rather
// than a grid with a visible scrollbar glued to the bottom.
export default function FoodCategories() {
  return (
    <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 snap-x snap-mandatory sm:mx-0 sm:grid sm:grid-cols-8 sm:gap-3 sm:overflow-visible sm:px-0 sm:pb-0">
      {FEATURED_CATEGORIES.map((c, i) => (
        <Link
          key={c.label}
          to={`/search?q=${encodeURIComponent(c.label)}`}
          style={{ transitionDelay: `${i * 40}ms` }}
          className="group flex w-20 shrink-0 snap-start flex-col items-center gap-1 rounded-xl border border-gray-100 bg-surface p-3 text-center shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-brand-400 hover:shadow-lg hover:shadow-brand-900/30 sm:w-auto"
        >
          <span className="text-2xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-125">
            {c.emoji}
          </span>
          <span className="text-xs font-medium text-gray-700">{c.label}</span>
        </Link>
      ))}
    </div>
  );
}
