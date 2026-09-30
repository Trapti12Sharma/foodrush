const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'foodrush_token';

function parseDurationToMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration || '');
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * unitMs[match[2]];
}

// M18 — the algorithm is pinned on BOTH sign and verify rather than left to the
// library's defaults. jsonwebtoken 9 already refuses `alg: none` for a string
// secret, so this is defence in depth rather than a live hole being closed: it
// means a token is only ever accepted if it was signed the one way this service
// signs them, and it stays true if the signing key is ever changed to an
// asymmetric one (the case where an unpinned verify becomes a real algorithm-
// confusion vulnerability). Pinning costs nothing and removes the need to
// re-reason about it later.
const JWT_ALGORITHM = 'HS256';

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    algorithm: JWT_ALGORITHM,
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET, { algorithms: [JWT_ALGORITHM] });
}

function cookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    // In dev, frontend and backend are different ports on localhost, which
    // browsers still treat as the same *site* — Lax is sent fine there. In a
    // real deployment they're different domains entirely (e.g. a Vercel
    // frontend calling a Render backend), which is cross-SITE, and a Lax
    // cookie is never attached to a cross-site fetch/XHR (only to top-level
    // navigations) — only None does that, and browsers require Secure
    // (HTTPS) alongside None, which `isProduction` already guarantees here.
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: parseDurationToMs(process.env.JWT_EXPIRES_IN),
  };
}

module.exports = { COOKIE_NAME, JWT_ALGORITHM, signToken, verifyToken, cookieOptions };
