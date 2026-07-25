const PDFDocument = require('pdfkit');
const db = require('../config/db');
const cartModel = require('../models/cart.model');
const productModel = require('../models/product.model');
const orderModel = require('../models/order.model');
const orderItemModel = require('../models/orderItem.model');
const orderAuditLogModel = require('../models/orderAuditLog.model');
const userModel = require('../models/user.model');
const siteThemeModel = require('../models/siteTheme.model');
const notificationService = require('./notification.service');
const { getStripeClient } = require('../config/stripe');
const ApiError = require('../utils/apiError');

const ADJUSTMENT_LABELS = {
  discount: 'Manual discount',
  shipping_change: 'Shipping adjustment',
  manual_adjustment: 'Manual adjustment',
};

// architecture.md §7.1 — the ONLY place order totals are computed. Recomputes
// and rewrites orders.subtotal/adjustment_total/tax_rate_percent/tax_amount/total
// from order_items rows, inside the caller's transaction. Tax uses whichever
// rate was already frozen onto the order (set once at createOrder time from
// site_theme, never re-read live) so a later site-wide rate change doesn't
// retroactively alter an existing order's tax — only the taxable amount is
// recomputed here when adjustments change it.
async function recomputeAndStoreTotals(orderId, trx) {
  const subtotal = await orderItemModel.sumLines(orderId, trx);
  const adjustmentTotal = await orderItemModel.sumAdjustments(orderId, trx);
  const existing = await orderModel.findById(orderId, trx);
  const taxRatePercent = Number(existing.tax_rate_percent) || 0;
  const taxableAmount = subtotal + adjustmentTotal;
  const taxAmount = Math.round(taxableAmount * (taxRatePercent / 100) * 100) / 100;
  const total = taxableAmount + taxAmount;
  await orderModel.updateTotals(orderId, { subtotal, adjustmentTotal, total, taxRatePercent, taxAmount }, trx);
  return { subtotal, adjustmentTotal, total, taxRatePercent, taxAmount };
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
    tax_rate_percent: Number(order.tax_rate_percent),
    tax_amount: Number(order.tax_amount),
    total: Number(order.total),
    stripe_payment_intent_id: order.stripe_payment_intent_id,
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

    // Freeze the tax rate active right now onto the order — recomputeAndStoreTotals
    // reads it back off the order row rather than site_theme, so later rate
    // changes never retroactively alter this order's tax.
    const theme = await siteThemeModel.getRow(trx);
    const taxRatePercent = Number(theme?.tax_rate_percent) || 0;
    await orderModel.updateTotals(id, { subtotal: 0, adjustmentTotal: 0, total: 0, taxRatePercent, taxAmount: 0 }, trx);

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

// Customer-facing cancel of their own not-yet-paid order: releases stock,
// best-effort cancels any Stripe PaymentIntent, then deletes the order and
// its related rows (order_items, order_audit_log) explicitly rather than
// relying on DB-level ON DELETE CASCADE.
async function cancelOrder(orderId, requester) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user_id !== requester.id && requester.role !== 'admin') {
    throw ApiError.notFound('Order not found');
  }
  if (order.status !== 'pending_payment') {
    throw ApiError.badRequest('Only orders awaiting payment can be cancelled');
  }

  if (order.stripe_payment_intent_id) {
    try {
      const stripe = getStripeClient();
      await stripe.paymentIntents.cancel(order.stripe_payment_intent_id);
    } catch (err) {
      // Already canceled/succeeded/never confirmed — fine to ignore and
      // proceed with deleting the order either way.
      console.error(`[order-cancel] failed to cancel PaymentIntent for order ${orderId}:`, err.message);
    }
  }

  await db.transaction(async (trx) => {
    const items = await orderItemModel.listByOrderId(orderId, trx);
    // eslint-disable-next-line no-restricted-syntax
    for (const item of items) {
      if (item.item_type === 'line' && item.product_id) {
        // eslint-disable-next-line no-await-in-loop
        await productModel.incrementStock(item.product_id, item.quantity, trx);
      }
    }
    await orderAuditLogModel.deleteByOrderId(orderId, trx);
    await orderItemModel.deleteByOrderId(orderId, trx);
    await orderModel.deleteOrder(orderId, trx);
  });
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
      tax_rate_percent: Number(row.tax_rate_percent),
      tax_amount: Number(row.tax_amount),
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
      tax_rate_percent: Number(row.tax_rate_percent),
      tax_amount: Number(row.tax_amount),
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

// Admin-triggered full refund: issues the actual Stripe refund against the
// order's PaymentIntent first, and only marks the order 'refunded' once
// Stripe confirms it — so the DB never says "refunded" for money Stripe
// hasn't actually returned.
async function refundOrder(order, reason, actorUserId) {
  if (order.status === 'pending_payment') {
    throw ApiError.badRequest('Order has not been paid — nothing to refund');
  }
  if (order.status === 'refunded') {
    throw ApiError.badRequest('Order has already been refunded');
  }
  if (!order.stripe_payment_intent_id) {
    throw ApiError.badRequest('Order has no associated payment to refund');
  }

  const stripe = getStripeClient();
  await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id });

  return db.transaction(async (trx) => {
    await orderModel.updateStatus(order.id, 'refunded', trx);
    await orderAuditLogModel.insertEntry(
      {
        orderId: order.id,
        actorUserId,
        fieldChanged: 'status',
        oldValue: order.status,
        newValue: 'refunded',
        reason: reason || 'Refunded by admin',
      },
      trx
    );
    const auditLogEntry = (await orderAuditLogModel.listByOrderId(order.id, trx)).at(-1);
    const shaped = await shapeOrder(order.id, trx);
    return { order: shaped, auditLogEntry };
  });
}

// architecture.md §7.1 — PATCH /api/admin/orders/:id
async function applyAdjustment(orderId, { type, amount, newStatus, reason }, actorUserId) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');

  if (type === 'refund') {
    return refundOrder(order, reason, actorUserId);
  }

  return db.transaction(async (trx) => {
    if (type === 'status_change') {
      if (!newStatus) throw ApiError.badRequest('newStatus is required for status_change');
      if (newStatus === 'refunded') {
        throw ApiError.badRequest('Use the refund adjustment to refund an order — this issues the actual Stripe refund, not just a status label');
      }
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

function formatMoney(amount) {
  return `$${Number(amount).toFixed(2)}`;
}

// Builds (but does not end/pipe) a PDFDocument invoice for a delivered order.
// Returns the stream so the controller owns piping it to the HTTP response
// and calling .end() — keeps this function pure/testable.
async function generateInvoice(orderId) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');

  // architecture.md-style defense-in-depth: this is a real server-side guard,
  // not just a UI gate (mirrors the discount sign-normalization convention —
  // business rules are enforced here even though the admin UI also hides the
  // button before this point).
  if (order.status !== 'delivered') {
    throw ApiError.badRequest('Invoice is only available once the order is delivered');
  }

  const [items, customer, theme] = await Promise.all([
    orderItemModel.listByOrderId(orderId),
    userModel.findById(order.user_id),
    siteThemeModel.getRow(),
  ]);

  const shippingAddress =
    typeof order.shipping_address === 'string'
      ? JSON.parse(order.shipping_address)
      : order.shipping_address;

  const subtotal = Number(order.subtotal);
  const adjustmentTotal = Number(order.adjustment_total);
  // Use the rate/amount frozen onto the order at checkout — not the current
  // site_theme rate, which may have changed since — so the invoice always
  // matches what the customer actually saw and paid.
  const taxRatePercent = Number(order.tax_rate_percent) || 0;
  const taxAmount = Number(order.tax_amount) || 0;
  const invoiceTotal = Number(order.total);

  const doc = new PDFDocument({ margin: 50 });

  const brandName = theme?.brand_name || 'Invoice';

  doc.fontSize(20).text(brandName, { continued: false });
  doc.fontSize(14).text('INVOICE', { align: 'right' });
  doc.moveDown();

  doc.fontSize(10);
  doc.text(`Order #${order.id}`);
  doc.text(`Date: ${new Date(order.created_at).toLocaleDateString()}`);
  doc.moveDown();

  doc.text(`Customer: ${customer?.name ?? 'N/A'}`);
  doc.text(`Email: ${customer?.email ?? 'N/A'}`);
  doc.moveDown();

  if (shippingAddress) {
    doc.text('Shipping address:');
    doc.text(shippingAddress.recipient_name ?? '');
    doc.text(
      `${shippingAddress.line1 ?? ''}${shippingAddress.line2 ? `, ${shippingAddress.line2}` : ''}`
    );
    doc.text(
      `${shippingAddress.city ?? ''}, ${shippingAddress.region ?? ''} ${shippingAddress.postal_code ?? ''}`
    );
    doc.text(shippingAddress.country ?? '');
    doc.moveDown();
  }

  // Line items table.
  const tableTop = doc.y + 10;
  const col = { label: 50, qty: 300, unit: 360, total: 450 };
  doc.font('Helvetica-Bold');
  doc.text('Item', col.label, tableTop);
  doc.text('Qty', col.qty, tableTop);
  doc.text('Unit', col.unit, tableTop);
  doc.text('Total', col.total, tableTop);
  doc.font('Helvetica');
  doc.moveDown(0.5);
  doc.moveTo(col.label, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);

  items.forEach((item) => {
    const y = doc.y;
    const lineTotal = item.unit_price !== null ? Number(item.unit_price) * item.quantity : Number(item.amount);
    doc.text(item.label, col.label, y, { width: 240 });
    doc.text(item.quantity !== null ? String(item.quantity) : '-', col.qty, y);
    doc.text(item.unit_price !== null ? formatMoney(item.unit_price) : '-', col.unit, y);
    doc.text(formatMoney(lineTotal), col.total, y);
    doc.moveDown();
  });

  doc.moveDown(0.5);
  doc.moveTo(col.label, doc.y).lineTo(550, doc.y).stroke();
  doc.moveDown(0.5);

  // Totals block, right-aligned. Each row's label/value are drawn at a fixed
  // y so they line up, then the cursor advances a fixed line height.
  const totalsX = 360;
  const lineHeight = 16;
  function totalsRow(label, value, bold) {
    if (bold) doc.font('Helvetica-Bold');
    const y = doc.y;
    doc.text(label, totalsX, y, { width: 100 });
    doc.text(value, col.total, y);
    doc.y = y + lineHeight;
    if (bold) doc.font('Helvetica');
  }
  totalsRow('Subtotal', formatMoney(subtotal));
  totalsRow('Adjustments', formatMoney(adjustmentTotal));
  totalsRow(`Tax (${taxRatePercent.toFixed(2)}%)`, formatMoney(taxAmount));
  doc.moveDown(0.3);
  totalsRow('Total', formatMoney(invoiceTotal), true);

  return doc;
}

module.exports = {
  createOrder,
  getOrderForRequester,
  cancelOrder,
  listOrdersForUser,
  listOrdersAdmin,
  getOrderAdmin,
  applyAdjustment,
  generateInvoice,
};
