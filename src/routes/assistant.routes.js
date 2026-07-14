const express = require('express');
const assistantController = require('../controllers/assistant.controller');
const { attachUserIfPresent } = require('../middleware/auth.middleware');
const { ensureAnonSession } = require('../middleware/anonSession.middleware');
const { assistantLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

// Public — works for both anonymous and logged-in callers, same pattern as
// cart.routes.js.
function maybeAnonSession(req, res, next) {
  if (req.user) return next();
  return ensureAnonSession(req, res, next);
}

router.post(
  '/assistant/messages',
  attachUserIfPresent,
  maybeAnonSession,
  assistantLimiter,
  assistantController.sendMessage
);

module.exports = router;
