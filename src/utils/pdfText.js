// Text extraction for indexed PDF resources (documentIndexing.service.js).
// pdf-parse does not OCR — scanned/image-only PDFs come back near-empty,
// which isLikelyEmpty() lets the caller detect and skip rather than
// embedding garbage.
const pdfParse = require('pdf-parse');

async function extractText(buffer) {
  const { text } = await pdfParse(buffer);
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
}

function isLikelyEmpty(text) {
  return text.trim().length < 200;
}

module.exports = { extractText, isLikelyEmpty };
