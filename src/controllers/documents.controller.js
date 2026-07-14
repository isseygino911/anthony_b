const documentService = require('../services/document.service');
const documentIndexingService = require('../services/documentIndexing.service');
const documentModel = require('../models/document.model');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const listDocuments = asyncHandler(async (req, res) => {
  const items = await documentService.listDocuments();
  res.status(200).json({ items });
});

const getDocument = asyncHandler(async (req, res) => {
  const document = await documentService.getDocument(Number(req.params.id));
  res.status(200).json(document);
});

const createDocument = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file uploaded');
  if (!req.body.title || !req.body.title.trim()) throw ApiError.badRequest('title is required');
  const document = await documentService.createDocument({
    title: req.body.title,
    category: req.body.category || null,
    file: req.file,
  });
  res.status(201).json(document);
});

const updateDocument = asyncHandler(async (req, res) => {
  const document = await documentService.updateDocument(Number(req.params.id), req.body);
  res.status(200).json(document);
});

const deleteDocument = asyncHandler(async (req, res) => {
  await documentService.deleteDocument(Number(req.params.id));
  res.status(204).end();
});

const reindexDocument = asyncHandler(async (req, res) => {
  const chunks = await documentIndexingService.indexDocument(Number(req.params.id));
  res.status(200).json({ chunksIndexed: chunks.length });
});

const reindexAllDocuments = asyncHandler(async (req, res) => {
  const documents = await documentModel.listAll();
  let totalChunks = 0;
  // Sequential, not parallel — avoids hammering the Gemini API.
  // eslint-disable-next-line no-restricted-syntax
  for (const document of documents) {
    // eslint-disable-next-line no-await-in-loop
    const chunks = await documentIndexingService.indexDocument(document.id);
    totalChunks += chunks.length;
  }
  res.status(200).json({ documentsIndexed: documents.length, totalChunks });
});

module.exports = {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  reindexDocument,
  reindexAllDocuments,
};
