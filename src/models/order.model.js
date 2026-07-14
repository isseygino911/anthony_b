const db = require('../config/db');

const TABLE = 'orders';
const REVENUE_EXCLUDED_STATUSES = ['cancelled', 'refunded'];

async function insertOrder(data, trx) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    user_id: data.userId,
    status: 'pending_payment',
    shipping_address: JSON.stringify(data.shippingAddress),
    subtotal: 0,
    adjustment_total: 0,
    total: 0,
    created_at: now,
    updated_at: now,
  });
  return id;
}

function updateTotals(orderId, { subtotal, adjustmentTotal, total }, trx) {
  return trx(TABLE)
    .where({ id: orderId })
    .update({ subtotal, adjustment_total: adjustmentTotal, total, updated_at: new Date() });
}

function updateStatus(orderId, status, trx) {
  return trx(TABLE).where({ id: orderId }).update({ status, updated_at: new Date() });
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

function listForUser(userId, { limit, offset }, trx = db) {
  return trx(TABLE)
    .where({ user_id: userId })
    .orderBy('created_at', 'desc')
    .limit(limit)
    .offset(offset);
}

function countForUser(userId, trx = db) {
  return trx(TABLE).where({ user_id: userId }).count({ count: '*' }).first();
}

function listAdmin(filters, { limit, offset }, trx = db) {
  const q = trx({ o: TABLE })
    .join('users as u', 'u.id', 'o.user_id')
    .select('o.*', 'u.name as customer_name', 'u.email as customer_email')
    .orderBy('o.created_at', 'desc')
    .limit(limit)
    .offset(offset);
  if (filters.status) q.where('o.status', filters.status);
  if (filters.search) {
    q.where((builder) => {
      builder
        .where('u.email', 'like', `%${filters.search}%`)
        .orWhere('u.name', 'like', `%${filters.search}%`)
        .orWhere('o.id', filters.search);
    });
  }
  return q;
}

function countAdmin(filters, trx = db) {
  const q = trx({ o: TABLE }).join('users as u', 'u.id', 'o.user_id').count({ count: 'o.id' }).first();
  if (filters.status) q.where('o.status', filters.status);
  if (filters.search) {
    q.where((builder) => {
      builder
        .where('u.email', 'like', `%${filters.search}%`)
        .orWhere('u.name', 'like', `%${filters.search}%`)
        .orWhere('o.id', filters.search);
    });
  }
  return q;
}

function getRevenueSeries(granularity, from, to, trx = db) {
  const periodExpr =
    granularity === 'monthly'
      ? "DATE_FORMAT(created_at, '%Y-%m')"
      : "DATE_FORMAT(created_at, '%Y-%m-%d')";

  const q = trx(TABLE)
    .select(trx.raw(`${periodExpr} as period`))
    .sum({ revenue: 'total' })
    .count({ orderCount: '*' })
    .whereNotIn('status', REVENUE_EXCLUDED_STATUSES)
    .groupByRaw(periodExpr)
    .orderByRaw(`${periodExpr} asc`);

  if (from) q.where('created_at', '>=', from);
  if (to) q.where('created_at', '<=', to);
  return q;
}

module.exports = {
  insertOrder,
  updateTotals,
  updateStatus,
  findById,
  listForUser,
  countForUser,
  listAdmin,
  countAdmin,
  getRevenueSeries,
  REVENUE_EXCLUDED_STATUSES,
};
