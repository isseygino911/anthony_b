// retrieval.service.rankFromCache — pure ranking logic over injected fake
// cache data (the seam retrieval.service.js was written around specifically
// to make this testable without a real DB/embedding cache).
import { describe, it, expect } from 'vitest';

const { rankFromCache } = require('../src/services/retrieval.service');

function fakeCache() {
  return {
    productEmbeddings: [
      { product_id: 1, embedding: [1, 0] }, // score 1
      { product_id: 2, embedding: [0.5, 0.5] }, // score ~0.707
      { product_id: 3, embedding: [0, 1] }, // score 0
    ],
    chunks: [
      { id: 10, document_id: 100, content: 'chunk A', embedding: [1, 0] }, // score 1
      { id: 11, document_id: 101, content: 'chunk B', embedding: [0.5, 0.5] }, // score ~0.707
      { id: 12, document_id: 102, content: 'chunk C', embedding: [-1, 0] }, // score -1
    ],
  };
}

describe('retrieval.service.rankFromCache', () => {
  it('ranks products by cosine similarity descending, capped at topKProducts', () => {
    const result = rankFromCache(fakeCache(), [1, 0], { topKProducts: 2, topKChunks: 0, minScore: -1 });

    expect(result.products.map((p) => p.productId)).toEqual([1, 2]);
    expect(result.products[0].score).toBeCloseTo(1, 10);
    expect(result.products[1].score).toBeCloseTo(Math.SQRT1_2, 5);
  });

  it('ranks chunks by cosine similarity descending, capped at topKChunks, and returns documentId/content', () => {
    const result = rankFromCache(fakeCache(), [1, 0], { topKProducts: 0, topKChunks: 2, minScore: -1 });

    expect(result.chunks).toEqual([
      { documentId: 100, chunkId: 10, content: 'chunk A', score: expect.closeTo(1, 10) },
      { documentId: 101, chunkId: 11, content: 'chunk B', score: expect.closeTo(Math.SQRT1_2, 5) },
    ]);
  });

  it('filters out products and chunks below minScore', () => {
    const result = rankFromCache(fakeCache(), [1, 0], { topKProducts: 5, topKChunks: 5, minScore: 0.5 });

    expect(result.products.map((p) => p.productId)).toEqual([1, 2]);
    expect(result.chunks.map((c) => c.documentId)).toEqual([100, 101]);
  });
});
