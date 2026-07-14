const documentService = require('../services/document.service');
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

module.exports = {
  listDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
};
