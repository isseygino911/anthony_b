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
// call. Keyed per identity, NOT per IP: these routes allow anonymous
// generation, and an office/campus/carrier-NAT shares one public IP, so
// IP-keying gave a whole building a combined 2/min — one visitor's preview
// locked out everyone else on their network. Signed-in users get more headroom
// than anonymous ones; an account is the accountability mechanism. The per-IP
// backstop below still caps a visitor who clears their cookie to mint a fresh
// anon session.
const neonGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req) => (req.user ? 5 : 2),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    if (req.user) return `user:${req.user.id}`;
    if (req.anonSessionId) return `anon:${req.anonSessionId}`;
    // Unreachable given maybeAnonSession runs first (customNeonDesigns.routes.js),
    // but keying on undefined would drop every such caller into one shared
    // bucket — fail closed on the IP rather than silently merging identities.
    return `ip:${req.ip}`;
  },
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many design generations — please wait a minute and try again' },
  },
});

// Abuse backstop for anonymous generation. The anon_session_id cookie is
// unsigned and its value is the row's primary key, so a visitor can reset
// their per-session budget just by clearing cookies — each reset would
// otherwise buy unlimited paid Gemini calls. Deliberately loose enough that a
// shared office/campus IP never reaches it in normal use (that was the bug
// the limiter above fixes), tight enough to stop a scripted loop.
const neonGenerationIpLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => Boolean(req.user), // signed-in callers are already keyed per account
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many design generations from this network — please wait a minute and try again',
    },
  },
});

// Public, unauthenticated subscribe endpoint — capped per-IP against
// scripted spam-subscribe abuse.
const newsletterLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many subscribe attempts, try again later' } },
});

// Contact form submissions. The route is behind requireAuth, so key on the
// account rather than the IP: a shared office/campus NAT would otherwise let
// one sender's enquiries lock out their colleagues (same bug the neon
// limiter documents above). Generous enough for someone legitimately
// enquiring about both partnering and a design, tight enough that a
// compromised account cannot flood the admin inbox.
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many messages sent — please try again later' },
  },
});

module.exports = {
  generalLimiter,
  loginLimiter,
  orderLimiter,
  assistantLimiter,
  adminAgentLimiter,
  neonGenerationLimiter,
  neonGenerationIpLimiter,
  newsletterLimiter,
  contactLimiter,
};
