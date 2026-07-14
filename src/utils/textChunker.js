// Pure text chunker used by documentIndexing.service.js — the seam that
// controls how much text goes into each embedded chunk. Snaps to a
// paragraph/sentence boundary near the end of the window when one is found
// close by, otherwise falls back to a fixed-size sliding window with
// overlap so behavior stays correct (and testable) on arbitrary text.

const BOUNDARY_LOOKBACK_RATIO = 0.3;

function findBoundary(text, start, end) {
  const lookback = Math.floor((end - start) * BOUNDARY_LOOKBACK_RATIO);
  const searchStart = Math.max(start, end - lookback);
  const window = text.slice(searchStart, end);

  const paraIdx = window.lastIndexOf('\n\n');
  if (paraIdx !== -1) return searchStart + paraIdx + 2;

  const sentenceMatches = [...window.matchAll(/[.!?]\s/g)];
  if (sentenceMatches.length) {
    const last = sentenceMatches[sentenceMatches.length - 1];
    return searchStart + last.index + last[0].length;
  }

  return -1;
}

function chunkText(text, { maxChars = 1200, overlapChars = 150 } = {}) {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const chunks = [];
  let start = 0;

  while (start < trimmed.length) {
    let end = Math.min(start + maxChars, trimmed.length);
    if (end < trimmed.length) {
      const boundary = findBoundary(trimmed, start, end);
      if (boundary > start) end = boundary;
    }

    const chunk = trimmed.slice(start, end).trim();
    if (chunk) chunks.push(chunk);

    if (end >= trimmed.length) break;
    start = Math.max(end - overlapChars, start + 1); // guarantee forward progress
  }

  return chunks;
}

module.exports = { chunkText };
