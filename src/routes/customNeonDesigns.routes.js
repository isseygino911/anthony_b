const express = require('express');
const multer = require('multer');
const customNeonDesignsController = require('../controllers/customNeonDesigns.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { neonGenerationLimiter } = require('../middleware/rateLimit.middleware');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

// Public landing-page gallery — must be registered before the requireAuth
// blanket below (and named "showcase", not a param route) so it's never
// mistaken for /custom-neon-designs/:id or swallowed by the auth gate.
router.get('/custom-neon-designs/showcase', customNeonDesignsController.listShowcase);

// Unlike cart, this requires login (not anon-session) — every design/regenerate
// call spends a Gemini image-generation call, so it's gated to accounts only
// to keep token usage attributable and abuse-resistant.
router.use('/custom-neon-designs', requireAuth);

// Generation-triggering routes only — 2 per user per minute (rateLimit.middleware.js).
router.post(
  '/custom-neon-designs',
  neonGenerationLimiter,
  upload.single('file'),
  customNeonDesignsController.createDesign
);
// "My Designs" — every design the caller has ever generated, any status.
router.get('/custom-neon-designs', customNeonDesignsController.listMine);
router.get('/custom-neon-designs/:id', customNeonDesignsController.getDesign);
router.post(
  '/custom-neon-designs/:id/regenerate',
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

module.exports = router;
