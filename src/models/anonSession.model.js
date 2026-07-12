const db = require('../config/db');

const TABLE = 'anon_sessions';

function findById(sessionId, trx = db) {
  return trx(TABLE).where({ session_id: sessionId }).first();
}

function insert(sessionId, trx = db) {
  const now = new Date();
  return trx(TABLE).insert({ session_id: sessionId, created_at: now, last_seen_at: now });
}

function touchLastSeen(sessionId, trx = db) {
  return trx(TABLE).where({ session_id: sessionId }).update({ last_seen_at: new Date() });
}

module.exports = { findById, insert, touchLastSeen };
