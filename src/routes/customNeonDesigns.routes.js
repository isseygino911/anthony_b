const express = require('express');
const multer = require('multer');
const customNeonDesignsController = require('../controllers/customNeonDesigns.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

// Unlike cart, this requires login (not anon-session) — every design/regenerate
// call spends a Gemini image-generation call, so it's gated to accounts only
// to keep token usage attributable and abuse-resistant.
router.use('/custom-neon-designs', requireAuth);

router.post('/custom-neon-designs', upload.single('file'), customNeonDesignsController.createDesign);
router.get('/custom-neon-designs/:id', customNeonDesignsController.getDesign);
router.post('/custom-neon-designs/:id/regenerate', customNeonDesignsController.regenerateDesign);
router.post('/custom-neon-designs/:id/confirm', customNeonDesignsController.confirmDesign);

router.get(
  '/admin/custom-neon-designs',
  requireAuth,
  requireAdmin,
  customNeonDesignsController.listDesignsAdmin
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
