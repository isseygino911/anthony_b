const rateLimit = require('express-rate-limit');

// General catalog/browsing limiter — generous, mounted globally in app.js.
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter limiter for brute-force-prone login (architecture.md §9).
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts, try again later' } },
});

// Stricter limiter for checkout-abuse surfaces (architecture.md §9).
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many order attempts, try again later' } },
});

module.exports = { generalLimiter, loginLimiter, orderLimiter };
