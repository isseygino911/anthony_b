const db = require('../config/db');

const TABLE = 'newsletter_subscribers';

function findByEmail(email, trx = db) {
  return trx(TABLE).where({ email }).first();
}

function insert(email, trx = db) {
  return trx(TABLE).insert({ email, subscribed_at: new Date() });
}

function list({ limit, offset } = {}, trx = db) {
  const query = trx(TABLE).select('id', 'email', 'subscribed_at').orderBy('subscribed_at', 'desc');
  if (limit !== undefined) query.limit(limit).offset(offset ?? 0);
  return query;
}

function count(trx = db) {
  return trx(TABLE).count({ count: '*' }).first();
}

module.exports = { findByEmail, insert, list, count };
