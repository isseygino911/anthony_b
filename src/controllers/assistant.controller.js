const assistantService = require('../services/assistant.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const sendMessage = asyncHandler(async (req, res) => {
  const { message, conversationId } = req.body;
  const trimmed = typeof message === 'string' ? message.trim() : '';
  if (!trimmed || trimmed.length > 2000) {
    throw ApiError.badRequest('message must be a non-empty string of at most 2000 characters');
  }

  const result = await assistantService.sendMessage({
    message: trimmed,
    userId: req.user.id,
    conversationId: conversationId ? Number(conversationId) : undefined,
  });

  res.status(200).json(result);
});

module.exports = { sendMessage };
