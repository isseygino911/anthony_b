const db = require('../config/db');
const cartModel = require('../models/cart.model');
const productModel = require('../models/product.model');
const orderModel = require('../models/order.model');
const orderItemModel = require('../models/orderItem.model');
const orderAuditLogModel = require('../models/orderAuditLog.model');
const notificationService = require('./notification.service');
const ApiError = require('../utils/apiError');

const ADJUSTMENT_LABELS = {
  discount: 'Manual discount',
  refund: 'Refund',
  shipping_change: 'Shipping adjustment',
  manual_adjustment: 'Manual adjustment',
};

// architecture.md §7.1 — the ONLY place order totals are computed. Recomputes
// and rewrites orders.subtotal/adjustment_total/total from order_items rows,
// inside the caller's transaction.
async function recomputeAndStoreTotals(orderId, trx) {
  const subtotal = await orderItemModel.sumLines(orderId, trx);
  const adjustmentTotal = await orderItemModel.sumAdjustments(orderId, trx);
  const total = subtotal + adjustmentTotal;
  await orderModel.updateTotals(orderId, { subtotal, adjustmentTotal, total }, trx);
  return { subtotal, adjustmentTotal, total };
}

async function shapeOrder(orderId, trx = db) {
  const order = await orderModel.findById(orderId, trx);
  if (!order) return null;
  const items = await orderItemModel.listByOrderId(orderId, trx);
  const shippingAddress =
    typeof order.shipping_address === 'string'
      ? JSON.parse(order.shipping_address)
      : order.shipping_address;
  return {
    id: order.id,
    user_id: order.user_id,
    status: order.status,
    shipping_address: shippingAddress,
    subtotal: Number(order.subtotal),
    adjustment_total: Number(order.adjustment_total),
    total: Number(order.total),
    created_at: order.created_at,
    updated_at: order.updated_at,
    items: items.map((item) => ({
      id: item.id,
      item_type: item.item_type,
      product_id: item.product_id,
      label: item.label,
      unit_price: item.unit_price !== null ? Number(item.unit_price) : null,
      quantity: item.quantity,
      amount: item.amount !== null ? Number(item.amount) : null,
    })),
  };
}

// architecture.md §2/§7 — POST /api/orders: snapshot cart -> order_items,
// decrement stock, notify on low-stock crossing, all in one transaction.
async function createOrder(userId, shippingAddress) {
  const cartRows = await cartModel.listWithProducts({ userId });
  if (!cartRows.length) throw ApiError.badRequest('Cart is empty');

  const orderId = await db.transaction(async (trx) => {
    const id = await orderModel.insertOrder({ userId, shippingAddress }, trx);

    const lines = cartRows.map((row) => ({
      productId: row.product_id,
      label: row.name,
      unitPrice: Number(row.price),
      quantity: row.quantity,
    }));
    await orderItemModel.insertLineItems(id, lines, trx);
    await recomputeAndStoreTotals(id, trx);

    // §7.2 stock decrement + low-stock notification, same transaction.
    // eslint-disable-next-line no-restricted-syntax
    for (const row of cartRows) {
      // eslint-disable-next-line no-await-in-loop
      const product = await productModel.findByIdForUpdate(row.product_id, trx);
      const oldQuantity = product.stock_quantity;
      const newQuantity = oldQuantity - row.quantity;
      // eslint-disable-next-line no-await-in-loop
      await productModel.decrementStock(row.product_id, row.quantity, trx);
      // eslint-disable-next-line no-await-in-loop
      await notificationService.checkAndNotifyLowStock(product, oldQuantity, newQuantity, trx);
      // eslint-disable-next-line no-await-in-loop
      await notificationService.checkAndNotifyCustomDesignOrdered(product, trx);
    }

    await cartModel.deleteAllForIdentity({ userId }, trx);

    return id;
  });

  return shapeOrder(orderId);
}

async function getOrderForRequester(orderId, requester) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user_id !== requester.id && requester.role !== 'admin') {
    throw ApiError.notFound('Order not found');
  }
  return shapeOrder(orderId);
}

async function listOrdersForUser(userId, { page, pageSize }) {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const [rows, countRow] = await Promise.all([
    orderModel.listForUser(userId, { limit, offset }),
    orderModel.countForUser(userId),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      subtotal: Number(row.subtotal),
      adjustment_total: Number(row.adjustment_total),
      total: Number(row.total),
      created_at: row.created_at,
    })),
    total: Number(countRow.count),
  };
}

async function listOrdersAdmin(filters, { page, pageSize }) {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const [rows, countRow] = await Promise.all([
    orderModel.listAdmin(filters, { limit, offset }),
    orderModel.countAdmin(filters),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      status: row.status,
      subtotal: Number(row.subtotal),
      adjustment_total: Number(row.adjustment_total),
      total: Number(row.total),
      created_at: row.created_at,
      customer_name: row.customer_name,
      customer_email: row.customer_email,
    })),
    total: Number(countRow.count),
  };
}

async function getOrderAdmin(orderId) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  const shaped = await shapeOrder(orderId);
  const auditLog = await orderAuditLogModel.listByOrderId(orderId);
  return { ...shaped, auditLog };
}

// architecture.md §7.1 — PATCH /api/admin/orders/:id
async function applyAdjustment(orderId, { type, amount, newStatus, reason }, actorUserId) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');

  return db.transaction(async (trx) => {
    if (type === 'status_change') {
      if (!newStatus) throw ApiError.badRequest('newStatus is required for status_change');
      const oldValue = order.status;
      await orderModel.updateStatus(orderId, newStatus, trx);
      await orderAuditLogModel.insertEntry(
        {
          orderId,
          actorUserId,
          fieldChanged: 'status',
          oldValue,
          newValue: newStatus,
          reason,
        },
        trx
      );
    } else {
      if (typeof amount !== 'number') throw ApiError.badRequest('amount is required for this adjustment type');
      const label = ADJUSTMENT_LABELS[type];
      if (!label) throw ApiError.badRequest('Unknown adjustment type');

      const oldTotal = Number(order.total);
      const normalizedAmount = type === 'discount' ? -Math.abs(amount) : amount;
      await orderItemModel.insertAdjustment(orderId, { label, amount: normalizedAmount }, trx);
      const totals = await recomputeAndStoreTotals(orderId, trx);
      await orderAuditLogModel.insertEntry(
        {
          orderId,
          actorUserId,
          fieldChanged: 'total',
          oldValue: String(oldTotal),
          newValue: String(totals.total),
          reason,
        },
        trx
      );
    }

    const auditLogEntry = (await orderAuditLogModel.listByOrderId(orderId, trx)).at(-1);
    const shaped = await shapeOrder(orderId, trx);
    return { order: shaped, auditLogEntry };
  });
}

module.exports = {
  createOrder,
  getOrderForRequester,
  listOrdersForUser,
  listOrdersAdmin,
  getOrderAdmin,
  applyAdjustment,
};
