// Pure helpers for image URLs and image bytes — no I/O, no SDK, easy to test.

// What may be stored in an `image`/`avatar` field: nothing (clears it), a file this
// server uploaded ("/uploads/<name>"), or an https:// URL (e.g. Cloudinary). Anything
// else — javascript:, data:, plain http:, protocol-relative, path traversal — is refused.
function isSafeImageUrl(value) {
  if (value === '' || value === null) return true;
  if (typeof value !== 'string' || value.length > 500) return false;
  if (/^\/uploads\/[A-Za-z0-9._-]+$/.test(value)) return true;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// Identifies the real file type from its first bytes. The Content-Type header and the
// file extension are chosen by the client, so neither can be trusted on their own.
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// Cloudinary assets are uploaded as  foodrush/<purpose>/<uploaderId>/<random>  and
// delivered as
//   https://res.cloudinary.com/<cloud>/image/upload/[transformations/][v123/]<public_id>[.ext]
// This extracts the parts needed to decide whether an asset may be deleted.
const CLOUDINARY_URL = /^https:\/\/res\.cloudinary\.com\/([^/]+)\/image\/upload\/(?:[^/]+\/)*?(?:v\d+\/)?(foodrush\/([a-z]+)\/([a-f0-9]{24})\/[A-Za-z0-9_-]+)(?:\.[A-Za-z0-9]+)?$/;

function parseCloudinaryUrl(url) {
  if (typeof url !== 'string') return null;
  const match = CLOUDINARY_URL.exec(url);
  if (!match) return null;
  const [, cloudName, publicId, purpose, ownerId] = match;
  return { cloudName, publicId, purpose, ownerId };
}

module.exports = { isSafeImageUrl, detectImageType, parseCloudinaryUrl };
