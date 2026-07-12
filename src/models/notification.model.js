const db = require('../config/db');

const TABLE = 'notifications';

function insertNotification(data, trx) {
  return trx(TABLE).insert({
    type: data.type,
    product_id: data.productId ?? null,
    message: data.message,
    is_read: false,
    created_at: new Date(),
  });
}

function list({ unreadOnly, limit, offset }, trx = db) {
  const q = trx(TABLE).select('*').orderBy('created_at', 'desc').limit(limit).offset(offset);
  if (unreadOnly) q.where({ is_read: false });
  return q;
}

function count({ unreadOnly }, trx = db) {
  const q = trx(TABLE).count({ count: '*' }).first();
  if (unreadOnly) q.where({ is_read: false });
  return q;
}

function countUnread(trx = db) {
  return trx(TABLE).where({ is_read: false }).count({ count: '*' }).first();
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

async function markRead(id, trx = db) {
  await trx(TABLE).where({ id }).update({ is_read: true });
  return findById(id, trx);
}

function markAllRead(trx = db) {
  return trx(TABLE).where({ is_read: false }).update({ is_read: true });
}

module.exports = { insertNotification, list, count, countUnread, findById, markRead, markAllRead };
