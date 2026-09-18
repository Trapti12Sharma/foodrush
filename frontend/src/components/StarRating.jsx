import { Star } from 'lucide-react';

export default function StarRating({ value, onChange, size = 16, readOnly = false }) {
  const stars = [1, 2, 3, 4, 5];
  return (
    <div className="flex items-center gap-0.5">
      {stars.map((star) => (
        <button
          key={star}
          type="button"
          disabled={readOnly}
          onClick={() => onChange?.(star)}
          className={readOnly ? 'cursor-default' : 'cursor-pointer'}
          aria-label={`${star} star${star > 1 ? 's' : ''}`}
        >
          <Star size={size} className={star <= value ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
        </button>
      ))}
    </div>
  );
}
