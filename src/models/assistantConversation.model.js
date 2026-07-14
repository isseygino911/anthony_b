const db = require('../config/db');

const TABLE = 'assistant_conversations';

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

// Most recent conversation for a logged-in user, for continuity across page
// loads. Not required for v1 correctness — a new conversation per session is
// fine — but cheap to support since assistant.service.js resolves by id first.
function findByUserId(userId, trx = db) {
  return trx(TABLE).where({ user_id: userId }).orderBy('id', 'desc').first();
}

function findByAnonSessionId(sessionId, trx = db) {
  return trx(TABLE).where({ anon_session_id: sessionId }).orderBy('id', 'desc').first();
}

async function create({ userId, anonSessionId }, trx = db) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    user_id: userId ?? null,
    anon_session_id: anonSessionId ?? null,
    created_at: now,
    updated_at: now,
  });
  return findById(id, trx);
}

module.exports = {
  findById,
  findByUserId,
  findByAnonSessionId,
  create,
};
