// Pure unit tests for the chunking seam used by documentIndexing.service.js.
import { describe, it, expect } from 'vitest';
const { chunkText } = require('../src/utils/textChunker');

describe('textChunker.chunkText', () => {
  it('returns [] for empty input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   ')).toEqual([]);
  });

  it('returns a single-element array when text is shorter than maxChars', () => {
    const text = 'A short paragraph about a product.';
    expect(chunkText(text, { maxChars: 1200 })).toEqual([text]);
  });

  it('splits longer text into multiple chunks, none exceeding maxChars', () => {
    const text = Array.from({ length: 50 }, (_, i) => `Sentence number ${i}.`).join(' ');
    const chunks = chunkText(text, { maxChars: 100, overlapChars: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((chunk) => {
      expect(chunk.length).toBeLessThanOrEqual(100);
    });
  });

  it('overlaps consecutive chunks by exactly overlapChars on the fixed-size sliding-window fallback', () => {
    // No whitespace/punctuation anywhere, so findBoundary() never matches and
    // the implementation falls back to a pure fixed-size sliding window —
    // makes the overlap arithmetic exactly predictable.
    const text = Array.from({ length: 500 }, (_, i) => String(i % 10)).join('');
    const chunks = chunkText(text, { maxChars: 100, overlapChars: 20 });

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length - 1; i += 1) {
      expect(chunks[i]).toHaveLength(100);
      const tail = chunks[i].slice(-20);
      const head = chunks[i + 1].slice(0, 20);
      expect(head).toBe(tail);
    }
  });

  it('covers the full input with no gaps (first and last characters both present)', () => {
    const text = Array.from({ length: 500 }, (_, i) => String(i % 10)).join('');
    const chunks = chunkText(text, { maxChars: 100, overlapChars: 20 });

    expect(chunks[0].startsWith(text.slice(0, 5))).toBe(true);
    expect(chunks[chunks.length - 1].endsWith(text.slice(-5))).toBe(true);
  });
});
