// Orchestrator for the Gemini product-finding assistant. Hard architectural
// constraint (verified by grepping this file's imports, see task notes):
// this file and everything it calls only ever reads through
// product.service.getProductDetail / document.service.getDocument — never a
// create/update/delete function from product/cart/order services or models.
const assistantConversationModel = require('../models/assistantConversation.model');
const assistantMessageModel = require('../models/assistantMessage.model');
const assistantGuardService = require('./assistantGuard.service');
const assistantPromptService = require('./assistantPrompt.service');
const retrievalService = require('./retrieval.service');
const embeddingService = require('./embedding.service');
const productService = require('./product.service');
const documentService = require('./document.service');
const { genAI } = require('../config/gemini');
const ApiError = require('../utils/apiError');

async function resolveConversation({ userId, anonSessionId, conversationId }) {
  if (conversationId) {
    const conversation = await assistantConversationModel.findById(conversationId);
    const belongsToRequester =
      conversation &&
      ((userId && conversation.user_id === userId) ||
        (!userId && anonSessionId && conversation.anon_session_id === anonSessionId));
    if (!belongsToRequester) throw ApiError.notFound('Conversation not found');
    return conversation;
  }

  if (userId) {
    const existing = await assistantConversationModel.findByUserId(userId);
    if (existing) return existing;
    return assistantConversationModel.create({ userId });
  }

  const existing = await assistantConversationModel.findByAnonSessionId(anonSessionId);
  if (existing) return existing;
  return assistantConversationModel.create({ anonSessionId });
}

async function resolveProducts(productIds = []) {
  const results = await Promise.all(
    productIds.map(async (id) => {
      try {
        return await productService.getProductDetail(id, { isAdmin: false });
      } catch {
        return null; // 404/soft-deleted — never trust the model's raw ID
      }
    })
  );
  return results.filter(Boolean);
}

async function resolveDocuments(documentIds = []) {
  const results = await Promise.all(
    documentIds.map(async (id) => {
      try {
        return await documentService.getDocument(id);
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

const GENERATION_FAILURE_REPLY = "Sorry, I couldn't put together an answer just now — could you try rephrasing?";

function parseModelResponse(text) {
  try {
    const parsed = JSON.parse(text);
    return {
      reply: typeof parsed.reply === 'string' ? parsed.reply : '',
      productIds: Array.isArray(parsed.productIds) ? parsed.productIds : [],
      documentIds: Array.isArray(parsed.documentIds) ? parsed.documentIds : [],
    };
  } catch (err) {
    console.error('[assistant.service] failed to parse Gemini JSON response', err);
    return { reply: GENERATION_FAILURE_REPLY, productIds: [], documentIds: [] };
  }
}

// Embedding + retrieval + the main generateContent call can all fail for
// reasons entirely outside our control (upstream quota/rate limits,
// transient network errors). Degrade to the same safe fallback used for a
// malformed response rather than a raw 500 — the user's message is already
// persisted at this point either way.
async function generateReply(message, historyMessages) {
  try {
    const queryEmbedding = await embeddingService.embedText(message);
    const retrieved = await retrievalService.retrieve(queryEmbedding);
    const request = await assistantPromptService.buildRequest({ message, historyMessages, retrieved });
    const response = await genAI.models.generateContent(request);
    return parseModelResponse(response.text || '');
  } catch (err) {
    console.error('[assistant.service] generateReply failed', err);
    return { reply: GENERATION_FAILURE_REPLY, productIds: [], documentIds: [] };
  }
}

async function sendMessage({ message, userId, anonSessionId, conversationId }) {
  const conversation = await resolveConversation({ userId, anonSessionId, conversationId });

  // Fetch prior turns before persisting the current message, so this window
  // never includes the message we're about to answer.
  const historyMessages = await assistantMessageModel.listByConversationId(conversation.id, { limit: 8 });

  await assistantMessageModel.insertMessage({ conversationId: conversation.id, role: 'user', content: message });

  const inScope = await assistantGuardService.classifyIntent(message);
  if (!inScope) {
    const reply = assistantGuardService.declineMessage();
    await assistantMessageModel.insertMessage({ conversationId: conversation.id, role: 'assistant', content: reply });
    return { conversationId: conversation.id, reply, products: [], documents: [] };
  }

  const { reply, productIds, documentIds } = await generateReply(message, historyMessages);

  const [products, documents] = await Promise.all([resolveProducts(productIds), resolveDocuments(documentIds)]);

  await assistantMessageModel.insertMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: reply,
    citedProductIds: products.map((p) => p.id),
    citedDocumentIds: documents.map((d) => d.id),
  });

  return { conversationId: conversation.id, reply, products, documents };
}

module.exports = { sendMessage };
