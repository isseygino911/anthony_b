const db = require('../config/db');

const TABLE = 'document_chunks';

function listByDocumentId(documentId, trx = db) {
  return trx(TABLE).where({ document_id: documentId }).orderBy('chunk_index', 'asc');
}

async function insertChunks(rows, trx = db) {
  if (rows.length === 0) return [];
  const now = new Date();
  return trx(TABLE).insert(
    rows.map((row) => ({
      ...row,
      embedding: JSON.stringify(row.embedding),
      created_at: now,
      updated_at: now,
    }))
  );
}

function deleteByDocumentId(documentId, trx = db) {
  return trx(TABLE).where({ document_id: documentId }).del();
}

function listAllWithEmbeddings(trx = db) {
  return trx(TABLE).select('*');
}

module.exports = {
  listByDocumentId,
  insertChunks,
  deleteByDocumentId,
  listAllWithEmbeddings,
};
