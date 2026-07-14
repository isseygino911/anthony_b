// Gemini client instance + model names, read from env. GEMINI_API_KEY is
// blank until the owner adds it; `isConfigured` lets embedding.service.js
// (and callers of it) fail gracefully instead of crashing the process,
// mirroring config/s3.js's isConfigured pattern.
const { GoogleGenAI } = require('@google/genai');
const config = require('./env');

const isConfigured = Boolean(config.gemini.apiKey);

const genAI = isConfigured ? new GoogleGenAI({ apiKey: config.gemini.apiKey }) : null;

module.exports = {
  genAI,
  isConfigured,
  embeddingModel: config.gemini.embeddingModel,
  chatModel: config.gemini.chatModel,
};
