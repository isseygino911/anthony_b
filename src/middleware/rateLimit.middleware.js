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

// Stricter limiter for the Gemini assistant — off-topic-gate is the primary
// cost control, this is the abuse-volume backstop (Stage 2 plan).
const assistantLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many assistant messages, try again later' } },
});

// Stricter limiter for the admin AI Insights agent — same abuse-volume
// backstop rationale as assistantLimiter, scoped to admins only.
const adminAgentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many analytics queries, try again later' } },
});

// Custom neon design create/regenerate each spend a Gemini image-generation
// call — capped per logged-in user (not per-IP, since these routes require
// auth) rather than the default IP-based key, so the limit tracks token
// usage per account regardless of shared/NATed IPs.
const neonGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 2,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : req.ip),
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many design generations — please wait a minute and try again' },
  },
});

module.exports = {
  generalLimiter,
  loginLimiter,
  orderLimiter,
  assistantLimiter,
  adminAgentLimiter,
  neonGenerationLimiter,
};
