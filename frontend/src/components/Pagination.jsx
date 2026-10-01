import { ChevronLeft, ChevronRight } from 'lucide-react';

// Shared pager for admin tables (Users, Restaurants, Delivery partners, ...).
// Takes the exact { page, limit, total, totalPages } shape the backend's
// buildPaginationMeta already returns, so a page just passes `meta` straight
// through with no reshaping.
//
// Renders nothing for a single page — a pager that's always visible even when
// there's nothing to page through is just noise.
export default function Pagination({ meta, onPageChange }) {
  if (!meta || meta.totalPages <= 1) return null;
  const { page, totalPages, total, limit } = meta;

  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  // Compact page-number list: first, last, current ±1, and `…` for the gaps —
  // so a 40-page table doesn't render 40 buttons.
  const pages = [];
  for (let p = 1; p <= totalPages; p += 1) {
    if (p === 1 || p === totalPages || Math.abs(p - page) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== '…') pages.push('…');
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm">
      <p className="text-gray-400">
        Showing <span className="font-medium text-gray-700">{from}–{to}</span> of{' '}
        <span className="font-medium text-gray-700">{total}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-500 transition hover:border-brand-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft size={15} />
        </button>
        {pages.map((p, i) =>
          p === '…' ? (
            <span key={`gap-${i}`} className="px-1.5 text-gray-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              className={`flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-sm font-medium transition ${
                p === page ? 'bg-brand-600 text-white' : 'text-gray-500 hover:bg-white/10 hover:text-gray-900'
              }`}
            >
              {p}
            </button>
          )
        )}
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-300 text-gray-500 transition hover:border-brand-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}
