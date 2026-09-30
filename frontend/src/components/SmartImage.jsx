import { useEffect, useRef, useState } from 'react';
import { FEATURED_CATEGORIES } from '../constants/cuisines';
import { buildSrcSet, optimizedUrl } from '../utils/images';

// Static class names (not built dynamically) so Tailwind keeps them in the bundle.
const GRADIENTS = [
  'from-orange-200 to-amber-100',
  'from-rose-200 to-orange-100',
  'from-amber-200 to-yellow-100',
  'from-red-200 to-orange-100',
  'from-lime-200 to-amber-100',
  'from-orange-300 to-rose-100',
  'from-yellow-200 to-orange-100',
  'from-emerald-200 to-lime-100',
];

function hash(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 2147483647;
  return h;
}

// A designed stand-in shown when there is no picture yet (or it failed to load): a soft
// gradient and a food emoji chosen from the cuisine/name — deliberately not a photo, and
// never a bare "No image" label. Stable per name, so a card doesn't change colour on re-render.
export function ImagePlaceholder({ label = '', cuisine = [], className = '' }) {
  const haystack = `${label} ${Array.isArray(cuisine) ? cuisine.join(' ') : cuisine}`.toLowerCase();
  const emoji = FEATURED_CATEGORIES.find((c) => haystack.includes(c.label.toLowerCase()))?.emoji || '🍽️';
  const gradient = GRADIENTS[hash(label || 'foodrush') % GRADIENTS.length];

  return (
    <div
      role="img"
      aria-label={label || 'Food'}
      className={`flex h-full w-full items-center justify-center bg-gradient-to-br ${gradient} ${className}`}
    >
      <span className="select-none text-3xl opacity-80" aria-hidden="true">
        {emoji}
      </span>
    </div>
  );
}

// Lazy-loaded, size-appropriate image with a loading skeleton and a graceful fallback.
//  - `aspect` (e.g. 4/3) reserves the box before the image arrives, so nothing jumps.
//  - Cloudinary URLs get a responsive srcset (see utils/images.js); others load as-is.
//  - `eager` is for the one above-the-fold hero image; everything else lazy-loads.
export default function SmartImage({
  src,
  alt,
  label,
  cuisine,
  className = '',
  aspect,
  widths = [240, 480, 720],
  sizes = '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw',
  eager = false,
}) {
  const [loaded, setLoaded] = useState(false);
  // Remember WHICH src failed, so a new src (e.g. after replacing the image) gets a fresh try.
  const [failedSrc, setFailedSrc] = useState('');
  const showFallback = !src || failedSrc === src;
  const largest = widths[widths.length - 1];
  const imgRef = useRef(null);

  // Reset the skeleton whenever the picture changes; a cached image can also finish loading
  // before React attaches onLoad, so check for that instead of waiting for an event.
  useEffect(() => {
    setLoaded(Boolean(imgRef.current?.complete && imgRef.current.naturalWidth > 0));
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-gray-100 ${className}`} style={aspect ? { aspectRatio: String(aspect) } : undefined}>
      {showFallback ? (
        <ImagePlaceholder label={label || alt} cuisine={cuisine} />
      ) : (
        <>
          {!loaded && <div className="absolute inset-0 animate-pulse bg-gray-200" aria-hidden="true" />}
          <img
            ref={imgRef}
            src={optimizedUrl(src, { width: largest, height: aspect ? Math.round(largest / aspect) : undefined })}
            srcSet={buildSrcSet(src, widths, aspect)}
            sizes={buildSrcSet(src, widths, aspect) ? sizes : undefined}
            alt={alt}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailedSrc(src)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      )}
    </div>
  );
}
