// CORS allow-list. Reads CLIENT_URL plus an optional comma-separated CLIENT_URLS
// (e.g. a custom domain alongside the vercel.app one). Every entry is trimmed and
// reduced to its bare origin, so a stray space, newline, trailing slash or path
// pasted into a dashboard can no longer break the header or silently mismatch.
// Matching is exact — there are no wildcards.
const DEFAULT_ORIGIN = 'http://localhost:5173';

function toOrigin(value) {
  try {
    const url = new URL(String(value).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function parseOrigins(env = process.env) {
  const raw = [env.CLIENT_URL, ...(env.CLIENT_URLS || '').split(',')];
  const origins = raw.filter((v) => v && String(v).trim()).map(toOrigin).filter(Boolean);
  return [...new Set(origins)];
}

// Evaluated per request (cheap) rather than once at import time, so the list always
// reflects the environment the server was actually started with.
function getAllowedOrigins(env = process.env) {
  const origins = parseOrigins(env);
  return origins.length > 0 ? origins : [DEFAULT_ORIGIN];
}

const corsOptions = {
  credentials: true,
  origin(origin, callback) {
    // No Origin header = not a browser cross-site request (curl, health checks,
    // server-to-server, Razorpay webhooks) — CORS doesn't apply to those.
    if (!origin) return callback(null, true);
    const normalized = toOrigin(origin);
    // A disallowed origin just gets no CORS headers; the browser blocks the response.
    callback(null, Boolean(normalized) && getAllowedOrigins().includes(normalized));
  },
};

module.exports = { corsOptions, parseOrigins, getAllowedOrigins, toOrigin };
