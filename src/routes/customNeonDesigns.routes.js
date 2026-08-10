const express = require('express');
const multer = require('multer');
const customNeonDesignsController = require('../controllers/customNeonDesigns.controller');
const {
  requireAuth,
  requireAdmin,
  attachUserIfPresent,
  COOKIE_NAME: AUTH_COOKIE_NAME,
} = require('../middleware/auth.middleware');
const { ensureAnonSession } = require('../middleware/anonSession.middleware');
const { neonGenerationLimiter, neonGenerationIpLimiter } = require('../middleware/rateLimit.middleware');
const ApiError = require('../utils/apiError');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

// Public landing-page gallery — must be registered before the identity
// middleware below (and named "showcase", not a param route) so it's never
// mistaken for /custom-neon-designs/:id.
router.get('/custom-neon-designs/showcase', customNeonDesignsController.listShowcase);

// attachUserIfPresent leaves req.user null both for a genuine anonymous
// visitor (no cookie at all) and for someone whose auth_token is expired or
// invalid. Those two must not be treated the same here: silently downgrading
// the second case to anonymous writes the design with user_id NULL, and
// belongsToIdentity checks user_id first for a logged-in caller — so the
// design is permanently unclaimable by the account that made it, with no
// error at the time to show anything went wrong. Fail loudly instead, the
// way requireAuth used to before anonymous generation was allowed.
function rejectStaleAuthCookie(req, res, next) {
  if (!req.user && req.cookies?.[AUTH_COOKIE_NAME]) {
    return next(ApiError.unauthorized('Your session has expired — please sign in again'));
  }
  return next();
}

// Works for both anonymous and logged-in callers, same convention as cart
// (routes/cart.routes.js) — an anon session cookie is only issued for
// unauthenticated visitors.
function maybeAnonSession(req, res, next) {
  if (req.user) return next();
  return ensureAnonSession(req, res, next);
}

router.use('/custom-neon-designs', attachUserIfPresent, rejectStaleAuthCookie, maybeAnonSession);

// Generation-triggering routes only. Two tiers (rateLimit.middleware.js): a
// per-network backstop for anonymous callers, then a per-identity cap —
// 5/min signed in, 2/min per anon session. The IP backstop runs first so the
// cheaper check short-circuits before the per-identity one.
router.post(
  '/custom-neon-designs',
  neonGenerationIpLimiter,
  neonGenerationLimiter,
  upload.single('file'),
  customNeonDesignsController.createDesign
);
// "My Designs" — every design the caller has ever generated, any status.
router.get('/custom-neon-designs', customNeonDesignsController.listMine);
// Must be registered before the :id param route below (same reasoning as
// showcase above) — "active" would otherwise be parsed as an :id.
router.get('/custom-neon-designs/active', customNeonDesignsController.getActiveDesign);
router.get('/custom-neon-designs/:id', customNeonDesignsController.getDesign);
router.post(
  '/custom-neon-designs/:id/regenerate',
  neonGenerationIpLimiter,
  neonGenerationLimiter,
  customNeonDesignsController.regenerateDesign
);
router.post('/custom-neon-designs/:id/confirm', customNeonDesignsController.confirmDesign);

router.get(
  '/admin/custom-neon-designs',
  requireAuth,
  requireAdmin,
  customNeonDesignsController.listDesignsAdmin
);
// Separate top-level path (not /admin/custom-neon-designs/:something) so it
// can never collide with the :id param route below.
router.get(
  '/admin/custom-neon-usage',
  requireAuth,
  requireAdmin,
  customNeonDesignsController.listUsageAdmin
);
router.get(
  '/admin/custom-neon-designs/:id',
  requireAuth,
  requireAdmin,
  customNeonDesignsController.getDesignAdmin
);
router.patch(
  '/admin/custom-neon-designs/:id',
  requireAuth,
  requireAdmin,
  customNeonDesignsController.updateDesignAdminNotes
);
// Gallery curation toggle. On its own sub-path rather than folded into the
// PATCH above, which is the admin-notes endpoint — same separation as
// PATCH /admin/products/:id/status.
router.patch(
  '/admin/custom-neon-designs/:id/showcase',
  requireAuth,
  requireAdmin,
  customNeonDesignsController.setDesignShowcased
);
// Publishes a design as a real catalog product. Separate from the customer
// confirm flow, and intentionally ignores design ownership — see
// createProductFromDesign in customNeonDesign.service.js.
router.post(
  '/admin/custom-neon-designs/:id/product',
  requireAuth,
  requireAdmin,
  customNeonDesignsController.createProductFromDesign
);

module.exports = router;
