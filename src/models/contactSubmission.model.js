const db = require('../config/db');

const TABLE = 'contact_submissions';

const COLUMNS = [
  'id',
  'topic',
  'user_id',
  'name',
  'email',
  'phone',
  'company',
  'message',
  'status',
  'admin_notes',
  'created_at',
  'updated_at',
];

function findById(id, trx = db) {
  return trx(TABLE).select(COLUMNS).where({ id }).first();
}

async function insert({ topic, userId, name, email, phone, company, message }, trx = db) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    topic,
    user_id: userId ?? null,
    name,
    email,
    phone: phone || null,
    company: company || null,
    message,
    status: 'new',
    created_at: now,
    updated_at: now,
  });
  return findById(id, trx);
}

// Shared by list() and count() so a filtered page and its total can never
// disagree about what they're counting.
function applyFilters(query, { topic, status }) {
  if (topic) query.where({ topic });
  if (status) query.where({ status });
  return query;
}

function list({ topic, status, limit, offset } = {}, trx = db) {
  const query = trx(TABLE).select(COLUMNS).orderBy('created_at', 'desc').orderBy('id', 'desc');
  applyFilters(query, { topic, status });
  if (limit !== undefined) query.limit(limit).offset(offset ?? 0);
  return query;
}

function count({ topic, status } = {}, trx = db) {
  return applyFilters(trx(TABLE).count({ count: '*' }).first(), { topic, status });
}

// Powers the "categorized" summary above the admin list: one row per
// topic/status pair, so the page can show per-topic totals and unhandled
// counts without pulling every submission back.
function countsByTopicAndStatus(trx = db) {
  return trx(TABLE).select('topic', 'status').count({ count: '*' }).groupBy('topic', 'status');
}

async function update(id, fields, trx = db) {
  await trx(TABLE)
    .where({ id })
    .update({ ...fields, updated_at: new Date() });
  return findById(id, trx);
}

module.exports = { findById, insert, list, count, countsByTopicAndStatus, update };
