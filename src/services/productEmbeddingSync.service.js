// syncProduct(product): hash-gated re-embed on product create/update — an
// unchanged name/description/tags skips the Gemini call entirely.
const crypto = require('crypto');
const productEmbeddingModel = require('../models/productEmbedding.model');
const { embeddingModel } = require('../config/gemini');
const embeddingService = require('./embedding.service');

// tags come back from the DB layer as either a JS array (real MySQL JSON
// column, auto-parsed by mysql2) or a JSON string (sqlite in tests) —
// mirrors product.service.js's parseTags() defensive handling.
function parseTags(tags) {
  if (!tags) return [];
  return typeof tags === 'string' ? JSON.parse(tags) : tags;
}

function computeSourceHash(product) {
  const raw = `${product.name}${product.description ?? ''}${JSON.stringify(parseTags(product.tags))}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function syncProduct(product) {
  const sourceHash = computeSourceHash(product);
  const existing = await productEmbeddingModel.findByProductId(product.id);
  if (existing && existing.source_hash === sourceHash) return existing;

  const text = `${product.name}\n${product.description ?? ''}\n${parseTags(product.tags).join(', ')}`;
  const embedding = await embeddingService.embedText(text);

  return productEmbeddingModel.upsertForProduct({
    productId: product.id,
    embedding,
    model: embeddingModel,
    sourceHash,
  });
}

module.exports = { syncProduct };
