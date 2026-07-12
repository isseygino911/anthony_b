const db = require('../config/db');

const TABLE = 'order_audit_log';

function insertEntry(data, trx) {
  return trx(TABLE).insert({
    order_id: data.orderId,
    actor_user_id: data.actorUserId,
    field_changed: data.fieldChanged,
    old_value: data.oldValue ?? null,
    new_value: data.newValue,
    reason: data.reason ?? null,
    created_at: new Date(),
  });
}

function listByOrderId(orderId, trx = db) {
  return trx(TABLE).where({ order_id: orderId }).orderBy('created_at', 'asc');
}

module.exports = { insertEntry, listByOrderId };
