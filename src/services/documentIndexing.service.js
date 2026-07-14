// indexDocument(documentId): fetch a PDF's raw bytes from S3, extract text,
// chunk it, embed the chunks, and replace-all into document_chunks — makes
// re-indexing idempotent (same row count every run, never additive).
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const documentModel = require('../models/document.model');
const documentChunkModel = require('../models/documentChunk.model');
const { s3Client, bucket, region, isConfigured: s3IsConfigured } = require('../config/s3');
const { embeddingModel } = require('../config/gemini');
const embeddingService = require('./embedding.service');
const pdfText = require('../utils/pdfText');
const { chunkText } = require('../utils/textChunker');
const ApiError = require('../utils/apiError');

const BUCKET_HOST_MARKER = `${bucket}.s3.${region}.amazonaws.com/`;

async function fetchPdfBuffer(url) {
  if (!s3IsConfigured) throw ApiError.internal('S3 not configured — set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/S3_BUCKET_NAME');
  const key = url.split(BUCKET_HOST_MARKER)[1];
  if (!key) throw ApiError.internal(`Document url is not an S3 object: ${url}`);
  const { Body } = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const bytes = await Body.transformToByteArray();
  return Buffer.from(bytes);
}

async function indexDocument(documentId) {
  const document = await documentModel.findById(documentId);
  if (!document) throw ApiError.notFound('Document not found');

  const buffer = await fetchPdfBuffer(document.url);
  const text = await pdfText.extractText(buffer);

  if (pdfText.isLikelyEmpty(text)) {
    // eslint-disable-next-line no-console
    console.warn(`[documentIndexing] document ${documentId} extracted near-empty text (scanned/image-only PDF?) — skipping`);
    return [];
  }

  const chunks = chunkText(text);
  const embeddings = await embeddingService.embedTexts(chunks);

  await documentChunkModel.deleteByDocumentId(documentId);
  const rows = chunks.map((content, index) => ({
    document_id: documentId,
    chunk_index: index,
    content,
    embedding: embeddings[index],
    embedding_model: embeddingModel,
  }));
  await documentChunkModel.insertChunks(rows);

  return rows;
}

module.exports = { indexDocument };
