// Pure similarity ranking helpers — retrieval.service.js's (Stage 2) intended
// seam over the in-process embedding cache. No vector DB needed at this
// scale; swap the implementation behind topK() if the catalog grows large.

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function topK(queryVector, candidates, k, minScore = 0) {
  return candidates
    .map((candidate) => ({ ...candidate, score: cosineSimilarity(queryVector, candidate.embedding) }))
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

module.exports = { cosineSimilarity, topK };
