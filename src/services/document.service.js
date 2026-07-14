const documentModel = require('../models/document.model');
const uploadService = require('../services/upload.service');
const documentIndexingService = require('./documentIndexing.service');
const ApiError = require('../utils/apiError');
const { signImageUrl } = require('../utils/signedImageUrl');
const { isConfigured: geminiIsConfigured } = require('../config/gemini');

// Fire-and-forget: indexing must never block or fail a document upload/save.
// No-ops silently if GEMINI_API_KEY isn't set yet (expected until configured).
function reindexNonFatal(id) {
  if (!geminiIsConfigured) return;
  documentIndexingService.indexDocument(id).catch((err) => {
    console.error(`[document.service] indexDocument(${id}) failed`, err);
  });
}

function shapeDocument(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    sort_order: row.sort_order,
  };
}

async function shapeDocumentWithUrl(row) {
  return { ...shapeDocument(row), url: await signImageUrl(row.url) };
}

async function listDocuments() {
  const rows = await documentModel.listAll();
  return Promise.all(rows.map(shapeDocumentWithUrl));
}

async function getDocument(id) {
  const row = await documentModel.findById(id);
  if (!row) throw ApiError.notFound('Document not found');
  return shapeDocumentWithUrl(row);
}

async function createDocument({ title, category, file }) {
  const url = await uploadService.uploadDocumentFile(file, category);
  const row = await documentModel.insertDocument({ title, category, url });
  reindexNonFatal(row.id);
  return shapeDocumentWithUrl(row);
}

async function updateDocument(id, data) {
  const existing = await documentModel.findById(id);
  if (!existing) throw ApiError.notFound('Document not found');
  const row = await documentModel.updateDocument(id, data);
  reindexNonFatal(id);
  return shapeDocumentWithUrl(row);
}

async function deleteDocument(id) {
  const existing = await documentModel.findById(id);
  if (!existing) throw ApiError.notFound('Document not found');
  await uploadService.deleteDocumentFile(existing.url);
  await documentModel.deleteDocument(id);
}

module.exports = {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
};
