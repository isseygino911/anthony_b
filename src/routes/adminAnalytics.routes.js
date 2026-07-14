const express = require('express');
const adminAnalyticsController = require('../controllers/adminAnalytics.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { adminAgentLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.post(
  '/admin/analytics/query',
  requireAuth,
  requireAdmin,
  adminAgentLimiter,
  adminAnalyticsController.query
);

module.exports = router;
