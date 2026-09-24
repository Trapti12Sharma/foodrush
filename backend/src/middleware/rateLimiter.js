const rateLimit = require('express-rate-limit');

// Rate limiting protects against real brute-force/credential-stuffing traffic —
// it has nothing to do with the correctness of the automated test suite, which
// legitimately registers/logs in far more than 20 times in a few seconds. Jest
// sets NODE_ENV=test automatically, so this never relaxes anything in a real
// deployment.
const isTest = process.env.NODE_ENV === 'test';

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limit for login/register specifically, to slow down credential
// stuffing / brute-force guessing beyond what the general API limiter allows.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again later.',
    errors: [],
  },
});

// Uploads are the most expensive thing a client can ask for (bandwidth, storage and, on
// Cloudinary, quota), so they get their own tighter ceiling on top of the general one.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100000 : 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many uploads. Please try again later.',
    errors: [],
  },
});

// Every call here spends real Google Maps quota, and the endpoints are public (guests pick
// a location before logging in), so this per-IP ceiling is the abuse guard. The frontend
// debounces typing well below it.
const geoLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 100000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many location requests. Please slow down.',
    errors: [],
  },
});

// Defense in depth alongside the per-order deliveryOtpAttempts counter (the real
// brute-force protection — see deliveryOtp.service.js): this just stops one IP
// from hammering the endpoint across many different assignment ids.
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please try again later.',
    errors: [],
  },
});

// Guards against spam ticket creation and message flooding — a real customer/rider/
// owner never needs anywhere near this many in 15 minutes; a script hammering the
// endpoint does.
const supportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 100000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many support requests. Please try again later.',
    errors: [],
  },
});

module.exports = { apiLimiter, authLimiter, uploadLimiter, geoLimiter, otpLimiter, supportLimiter };
