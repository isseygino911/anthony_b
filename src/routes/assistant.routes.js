const express = require('express');
const assistantController = require('../controllers/assistant.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { assistantLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

// Logged-in users only — anonymous visitors are rejected with 401.
router.post(
  '/assistant/messages',
  requireAuth,
  assistantLimiter,
  assistantController.sendMessage
);

module.exports = router;
