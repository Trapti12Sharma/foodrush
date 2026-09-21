// Image URL helpers shared by every component that shows or uploads a picture.

// The backend serves locally uploaded files from its own origin (…/uploads/…), not the
// frontend's — the API base URL already carries that origin, minus the /api suffix.
const API_ORIGIN = (import.meta.env.VITE_API_URL || 'http://localhost:5000/api').replace(/\/api\/?$/, '');

export function resolveImageUrl(url) {
  if (!url) return '';
  return url.startsWith('http') ? url : `${API_ORIGIN}${url}`;
}

const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.+)$/;

export function isCloudinaryUrl(url) {
  return CLOUDINARY_UPLOAD.test(resolveImageUrl(url));
}

// For Cloudinary images, asks Cloudinary itself to resize and re-encode: f_auto picks the
// best format the browser supports (WebP/AVIF), q_auto picks a sensible quality, and
// w_/h_/c_fill deliver the size actually needed instead of the original upload. Any other
// URL (local dev upload, external image) is returned unchanged.
export function optimizedUrl(url, { width, height } = {}) {
  const resolved = resolveImageUrl(url);
  const match = CLOUDINARY_UPLOAD.exec(resolved);
  if (!match) return resolved;
  const transformation = ['f_auto', 'q_auto', width && `w_${width}`, height && `h_${height}`, (width || height) && 'c_fill']
    .filter(Boolean)
    .join(',');
  return `${match[1]}${transformation}/${match[2]}`;
}

// `srcset` so the browser downloads the smallest adequate file. Only meaningful for
// Cloudinary (which can produce each width on demand); otherwise undefined.
export function buildSrcSet(url, widths, aspect) {
  if (!isCloudinaryUrl(url)) return undefined;
  return widths
    .map((width) => `${optimizedUrl(url, { width, height: aspect ? Math.round(width / aspect) : undefined })} ${width}w`)
    .join(', ');
}
