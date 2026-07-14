// In-process retrieval over embeddingCache.service's cached rows — the
// injectable-data seam (`cacheData` param) is what makes this unit-testable
// without a real cache/DB. Ranking itself is delegated to
// utils/cosineSimilarity.js's topK().
const embeddingCacheService = require('./embeddingCache.service');
const { topK } = require('../utils/cosineSimilarity');

// Pure ranking over already-loaded cache rows — the unit-test target.
function rankFromCache({ chunks, productEmbeddings }, queryEmbedding, { topKProducts, topKChunks, minScore }) {
  const products = topK(queryEmbedding, productEmbeddings, topKProducts, minScore).map((row) => ({
    productId: row.product_id,
    score: row.score,
  }));

  const chunkResults = topK(queryEmbedding, chunks, topKChunks, minScore).map((row) => ({
    documentId: row.document_id,
    chunkId: row.id,
    content: row.content,
    score: row.score,
  }));

  return { products, chunks: chunkResults };
}

async function retrieve(queryEmbedding, { topKProducts = 5, topKChunks = 5, minScore = 0.3 } = {}) {
  // Correctness over micro-optimization at this scale: always (re)load so a
  // cold/empty cache (e.g. boot-load failed) doesn't silently return nothing.
  await embeddingCacheService.load();
  const cacheData = { chunks: embeddingCacheService.getChunks(), productEmbeddings: embeddingCacheService.getProductEmbeddings() };
  return rankFromCache(cacheData, queryEmbedding, { topKProducts, topKChunks, minScore });
}

module.exports = { retrieve, rankFromCache };
