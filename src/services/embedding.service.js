// Thin wrapper over config/gemini.js's client — the only place that calls
// Gemini's embeddings API. model name is centralized in config/gemini.js.
const { genAI, isConfigured, embeddingModel } = require('../config/gemini');
const ApiError = require('../utils/apiError');

function assertConfigured() {
  if (!isConfigured) {
    throw ApiError.internal('Gemini not configured — set GEMINI_API_KEY');
  }
}

async function embedText(text) {
  assertConfigured();
  const response = await genAI.models.embedContent({ model: embeddingModel, contents: [text] });
  return response.embeddings[0].values;
}

async function embedTexts(texts) {
  assertConfigured();
  if (texts.length === 0) return [];
  const response = await genAI.models.embedContent({ model: embeddingModel, contents: texts });
  return response.embeddings.map((embedding) => embedding.values);
}

module.exports = { embedText, embedTexts };
