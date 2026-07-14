const db = require('../config/db');

const TABLE = 'assistant_messages';

async function insertMessage(
  { conversationId, role, content, citedProductIds, citedDocumentIds },
  trx = db
) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    conversation_id: conversationId,
    role,
    content,
    cited_product_ids: citedProductIds ? JSON.stringify(citedProductIds) : null,
    cited_document_ids: citedDocumentIds ? JSON.stringify(citedDocumentIds) : null,
    created_at: now,
  });
  return trx(TABLE).where({ id }).first();
}

// Most recent `limit` messages for a conversation, returned oldest-first so
// callers can drop them straight into a chat history array.
async function listByConversationId(conversationId, { limit = 8 } = {}, trx = db) {
  const rows = await trx(TABLE)
    .where({ conversation_id: conversationId })
    .orderBy('id', 'desc')
    .limit(limit);
  return rows.reverse();
}

module.exports = {
  insertMessage,
  listByConversationId,
};
