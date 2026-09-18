const jwt = require('jsonwebtoken');

const COOKIE_NAME = 'foodrush_token';

function parseDurationToMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration || '');
  if (!match) return 7 * 24 * 60 * 60 * 1000; // default 7d
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };
  return value * unitMs[match[2]];
}

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: parseDurationToMs(process.env.JWT_EXPIRES_IN),
  };
}

module.exports = { COOKIE_NAME, signToken, verifyToken, cookieOptions };
