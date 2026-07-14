const adminAnalyticsService = require('../services/adminAnalytics.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const HISTORY_LIMIT = 6;

// Defensively re-validate/re-cap history regardless of what the client
// sends — the server holds nothing between requests, so this array is the
// only conversational context Stage 1/Stage 3 ever see.
function sanitizeHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string')
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 2000) }))
    .slice(-HISTORY_LIMIT);
}

const query = asyncHandler(async (req, res) => {
  const { message, history } = req.body;
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed || trimmed.length > 2000) {
    throw ApiError.badRequest('message must be a non-empty string of at most 2000 characters');
  }

  const result = await adminAnalyticsService.query({ message: trimmed, history: sanitizeHistory(history) });

  res.status(200).json(result);
});

module.exports = { query };
