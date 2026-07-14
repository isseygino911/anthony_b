// In-process singleton cache of every embedding in MySQL, for Stage 2's
// retrieval.service.js to do in-memory cosine similarity over — no vector DB
// needed at this scale. NOT loaded automatically at require-time (would
// break app boot/tests when Gemini/DB aren't ready); load() must be called
// explicitly by whatever wires up the server (e.g. once at boot, after
// config/gemini.js reports isConfigured), and reload() after re-indexing.
const documentChunkModel = require('../models/documentChunk.model');
const productEmbeddingModel = require('../models/productEmbedding.model');

let chunks = [];
let productEmbeddings = [];

function parseEmbedding(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function load() {
  const [chunkRows, productRows] = await Promise.all([
    documentChunkModel.listAllWithEmbeddings(),
    productEmbeddingModel.listAllWithEmbeddings(),
  ]);
  chunks = chunkRows.map((row) => ({ ...row, embedding: parseEmbedding(row.embedding) }));
  productEmbeddings = productRows.map((row) => ({ ...row, embedding: parseEmbedding(row.embedding) }));
}

function getChunks() {
  return chunks;
}

function getProductEmbeddings() {
  return productEmbeddings;
}

async function reload() {
  await load();
}

module.exports = { load, reload, getChunks, getProductEmbeddings };
