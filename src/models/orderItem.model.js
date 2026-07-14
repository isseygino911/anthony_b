const db = require('../config/db');
const { REVENUE_EXCLUDED_STATUSES } = require('./order.model');

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

// Top-selling products by units or revenue over a date range, for the admin
// analytics agent. Left-joins products (not inner) so a since-deleted
// product still shows up for historical orders; COALESCE falls back to the
// label captured on the order line at purchase time rather than fabricating
// a name. MAX() around both sides keeps this valid under MySQL's
// ONLY_FULL_GROUP_BY even though product_id -> name is 1:1 in practice.
function getTopProducts({ from, to, metric, limit }, trx = db) {
  const orderExpr = metric === 'revenue' ? 'revenue' : 'unitsSold';

  const q = trx({ oi: TABLE })
    .join('orders as o', 'o.id', 'oi.order_id')
    .leftJoin('products as p', 'p.id', 'oi.product_id')
    .where('oi.item_type', 'line')
    .whereNotIn('o.status', REVENUE_EXCLUDED_STATUSES)
    .groupBy('oi.product_id')
    .select('oi.product_id as productId')
    .select(trx.raw('COALESCE(MAX(p.name), MAX(oi.label)) as name'))
    .select(trx.raw('SUM(oi.quantity) as unitsSold'))
    .select(trx.raw('SUM(oi.unit_price * oi.quantity) as revenue'))
    .orderBy(orderExpr, 'desc')
    .limit(limit);

  if (from) q.where('o.created_at', '>=', from);
  if (to) q.where('o.created_at', '<=', to);
  return q;
}

module.exports = { insertLineItems, insertAdjustment, listByOrderId, sumLines, sumAdjustments, getTopProducts };
