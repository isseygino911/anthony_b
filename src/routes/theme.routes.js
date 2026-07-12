const express = require('express');
const multer = require('multer');
const themeController = require('../controllers/theme.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.get('/theme', themeController.getTheme);
router.put('/admin/theme', requireAuth, requireAdmin, themeController.updateTheme);
router.post(
  '/admin/theme/logo',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  themeController.uploadLogo
);

module.exports = router;
