const { COOKIE_NAME } = require('../services/token.service');
const { resolveUserFromToken } = require('../middleware/auth.middleware');

// Finds one named cookie's value in a raw `Cookie:` header. Deliberately hand-
// rolled instead of pulling in a library: the format needed here is just
// `name=value` pairs separated by `; `, and a JWT itself is already
// header/cookie-safe (base64url + dots), so no decoding beyond this is needed —
// exactly what express's own `cookie-parser` does for the simple case, without
// taking on a dependency (the top-level `cookie` package's current major version
// ships ESM-only, which this CommonJS codebase — and Jest — can't `require()`).
function findCookie(rawCookieHeader, name) {
  if (!rawCookieHeader) return null;
  for (const part of rawCookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// Mirrors auth.middleware.js's extractToken(req), adapted for a handshake instead
// of an Express request. The real browser frontend authenticates the SAME way it
// already does over HTTP — the httpOnly cookie — so the socket connection needs no
// client-accessible token and no weakening of the existing XSS posture (the app
// deliberately never puts the JWT anywhere JavaScript can read it). `auth.token`
// is a secondary path for tests and any future non-browser client.
function extractTokenFromSocket(socket) {
  const explicit = socket.handshake.auth?.token;
  if (explicit) return explicit;
  return findCookie(socket.handshake.headers?.cookie, COOKIE_NAME);
}

// Rejects the connection outright (next(new Error(...))) on any failure — the
// client never gets as far as `connect`, so there is no authenticated-but-invalid
// intermediate state to guard against elsewhere. The message is always the
// generic, already-safe text resolveUserFromToken/verifyToken produce — never a
// raw stack trace or internal detail.
async function socketAuthMiddleware(socket, next) {
  try {
    const token = extractTokenFromSocket(socket);
    const user = await resolveUserFromToken(token);
    socket.user = user;
    next();
  } catch (err) {
    next(new Error(err.message || 'Authentication failed'));
  }
}

module.exports = { socketAuthMiddleware, extractTokenFromSocket };
