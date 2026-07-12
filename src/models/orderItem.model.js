const db = require('../config/db');

const TABLE = 'order_items';

async function insertLineItems(orderId, lines, trx) {
  const now = new Date();
  const rows = lines.map((line) => ({
    order_id: orderId,
    item_type: 'line',
    product_id: line.productId,
    label: line.label,
    unit_price: line.unitPrice,
    quantity: line.quantity,
    amount: null,
    created_at: now,
  }));
  await trx(TABLE).insert(rows);
}

async function insertAdjustment(orderId, { label, amount }, trx) {
  await trx(TABLE).insert({
    order_id: orderId,
    item_type: 'adjustment',
    product_id: null,
    label,
    unit_price: null,
    quantity: null,
    amount,
    created_at: new Date(),
  });
}

function listByOrderId(orderId, trx = db) {
  return trx(TABLE).where({ order_id: orderId }).orderBy('id', 'asc');
}

async function sumLines(orderId, trx) {
  const row = await trx(TABLE)
    .where({ order_id: orderId, item_type: 'line' })
    .sum({ total: trx.raw('unit_price * quantity') })
    .first();
  return Number(row.total) || 0;
}

async function sumAdjustments(orderId, trx) {
  const row = await trx(TABLE)
    .where({ order_id: orderId, item_type: 'adjustment' })
    .sum({ total: 'amount' })
    .first();
  return Number(row.total) || 0;
}

module.exports = { insertLineItems, insertAdjustment, listByOrderId, sumLines, sumAdjustments };
