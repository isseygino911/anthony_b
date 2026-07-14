// Pure unit tests for the ranking seam Stage 2's retrieval.service.js will
// build on.
import { describe, it, expect } from 'vitest';
const { cosineSimilarity, topK } = require('../src/utils/cosineSimilarity');

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
  });

  it('is 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('is -1 for exactly opposite vectors', () => {
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1, 10);
  });

  it('returns 0 when either vector is all zeros (no division by zero)', () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe('topK', () => {
  const query = [1, 0];
  const candidates = [
    { id: 'a', embedding: [1, 0] }, // score 1
    { id: 'b', embedding: [0.5, 0.5] }, // score ~0.707
    { id: 'c', embedding: [0, 1] }, // score 0
    { id: 'd', embedding: [-1, 0] }, // score -1
  ];

  it('returns the top k candidates sorted descending by score, each annotated with score', () => {
    const result = topK(query, candidates, 2);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
    expect(result[0].score).toBeCloseTo(1, 10);
    expect(result[1].score).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('filters out candidates below minScore', () => {
    const result = topK(query, candidates, 10, 0.5);
    expect(result.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('returns an empty array when k is 0', () => {
    expect(topK(query, candidates, 0)).toEqual([]);
  });
});
