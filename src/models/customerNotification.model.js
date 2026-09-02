const db = require('../config/db');

const TABLE = 'customer_notifications';

// The customer-facing counterpart to notification.model.js. Every read here
// is scoped by user_id — these rows are addressed to one person, unlike the
// admin table's broadcasts (see migration 041 for why they are separate).
function insert(data, trx = db) {
  return trx(TABLE).insert({
    user_id: data.userId,
    type: data.type,
    order_id: data.orderId ?? null,
    message: data.message,
    is_read: false,
    created_at: new Date(),
  });
}

function list(userId, { unreadOnly, limit, offset }, trx = db) {
  const q = trx(TABLE)
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
  if (unreadOnly) q.andWhere({ is_read: false });
  return q;
}

function count(userId, { unreadOnly }, trx = db) {
  const q = trx(TABLE).where({ user_id: userId }).count({ count: '*' }).first();
  if (unreadOnly) q.andWhere({ is_read: false });
  return q;
}

function countUnread(userId, trx = db) {
  return trx(TABLE).where({ user_id: userId, is_read: false }).count({ count: '*' }).first();
}

// user_id is part of the WHERE rather than checked by the caller, so one
// customer can never mark another's notification read by guessing an id.
async function markRead(id, userId, trx = db) {
  await trx(TABLE).where({ id, user_id: userId }).update({ is_read: true });
  return trx(TABLE).where({ id, user_id: userId }).first();
}

function markAllRead(userId, trx = db) {
  return trx(TABLE).where({ user_id: userId, is_read: false }).update({ is_read: true });
}

module.exports = { insert, list, count, countUnread, markRead, markAllRead };
