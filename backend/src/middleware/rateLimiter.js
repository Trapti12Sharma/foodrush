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

module.exports = { apiLimiter, authLimiter };
