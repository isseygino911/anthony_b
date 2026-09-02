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
const contactService = require('./contact.service');
const customerNotificationModel = require('../models/customerNotification.model');
const customNeonDesignModel = require('../models/customNeonDesign.model');
const customNeonDesignService = require('./customNeonDesign.service');
const uploadService = require('./upload.service');

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
      // The frozen size/colour snapshot (buildNeonSnapshot). Parsed here so
      // every consumer gets an object rather than a JSON string.
      selected_options:
        typeof item.selected_options === 'string'
          ? JSON.parse(item.selected_options)
          : (item.selected_options ?? null),
    })),
  };
}

// Appends a snapshot's descriptive attributes to the product name, e.g.
// 'Custom Neon Design #7 — 36"x36", Ice Blue'. Only zero-priced, non-fee
// choices are used: priced options are already itemised as their own lines
// or folded into unit_price, so repeating them here would read as if they
// were being charged twice. Products without a snapshot are unaffected.
function buildLineLabel(name, selectedOptions) {
  const descriptive = (selectedOptions?.choices || [])
    .filter((choice) => !choice.isFlatFee && !choice.priceDelta)
    .filter((choice) => choice.groupKey !== 'neon_size') // implied by the dimensions
    .map((choice) => choice.choiceLabel)
    .filter((label) => label && label !== '—');
  return descriptive.length ? `${name} — ${descriptive.join(', ')}` : name;
}

// architecture.md §2/§7 — POST /api/orders: snapshot cart -> order_items,
// decrement stock, notify on low-stock crossing, all in one transaction.
async function createOrder(userId, shippingAddress, contact = null) {
  const cartRows = await cartModel.listWithProducts({ userId });
  if (!cartRows.length) throw ApiError.badRequest('Cart is empty');

  // An unpriced custom-size line (products.is_quote, migration 042) makes the
  // whole order a quote request: there is no total to charge, so it is held
  // at 'pending_quote' and Stripe is never involved until an admin prices it.
  // Whole-order rather than per-line because an order has exactly one status
  // and one payment — splitting a mixed cart into a paid order plus a quoted
  // one would silently create two orders from one checkout.
  const isQuote = cartRows.some((row) => row.is_quote);

  // Contact details are what the business follows the quote up on, so they
  // are required before the order is created rather than chased afterwards.
  // Validated here (outside the transaction) so a bad payload never leaves a
  // half-written order behind.
  const contactDetails = isQuote ? contactService.assertQuoteContact(contact) : null;

  const orderId = await db.transaction(async (trx) => {
    const id = await orderModel.insertOrder(
      { userId, shippingAddress, status: isQuote ? 'pending_quote' : 'pending_payment' },
      trx
    );

    // Freeze the tax rate active right now onto the order — recomputeAndStoreTotals
    // reads it back off the order row rather than site_theme, so later rate
    // changes never retroactively alter this order's tax.
    const theme = await siteThemeModel.getRow(trx);
    const taxRatePercent = Number(theme?.tax_rate_percent) || 0;
    await orderModel.updateTotals(id, { subtotal: 0, adjustmentTotal: 0, total: 0, taxRatePercent, taxAmount: 0 }, trx);

    // Configured lines (cart.model.js's unit_price) carry the price frozen
    // at add-to-cart time; plain lines use the live product price, same as
    // before. A flat one-time fee (e.g. installation — see pricing.service.js's
    // isFlatFee choices) becomes its own separate 'line' row at quantity 1 so
    // it is never multiplied by the configured item's quantity.
    const lines = [];
    cartRows.forEach((row) => {
      const selectedOptions = row.selected_options
        ? typeof row.selected_options === 'string'
          ? JSON.parse(row.selected_options)
          : row.selected_options
        : null;
      // unit_price is NULLABLE (010) and SUM() skips NULLs, so a quote line
      // contributes nothing to the subtotal rather than contributing its
      // placeholder 0.00 — the total stays honest until the admin prices it.
      const unitPrice = row.is_quote
        ? null
        : row.configured_unit_price != null
          ? Number(row.configured_unit_price)
          : Number(row.price);
      lines.push({
        productId: row.product_id,
        // The label absorbs the snapshot's descriptive choices (a neon
        // design's dimensions and colour) so the line still says what was
        // bought in plain text — invoices and the order list render `label`
        // alone, and product_id is ON DELETE SET NULL.
        label: buildLineLabel(row.name, selectedOptions),
        unitPrice,
        quantity: row.quantity,
        selectedOptions,
      });

      const flatFeeChoices = (selectedOptions?.choices || []).filter((c) => c.priceDelta && c.isFlatFee);
      flatFeeChoices.forEach((choice) => {
        lines.push({
          productId: row.product_id,
          label: `${row.name} — ${choice.choiceLabel}`,
          unitPrice: choice.priceDelta,
          quantity: 1,
          selectedOptions: null,
        });
      });
    });
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

    // Everything the quote needs to be actioned is written in the same
    // transaction as the order itself: the enquiry the admin works from, the
    // admin's alert, and the customer's own confirmation. An order sitting
    // unpriced that nobody was told about is the exact failure this feature
    // exists to prevent, so none of the four is allowed to land without the
    // others.
    if (isQuote) {
      await contactService.createQuoteRequest({ userId, orderId: id, contact: contactDetails }, trx);
      await customerNotificationModel.insert(
        {
          userId,
          type: 'quote_requested',
          orderId: id,
          message: `Thanks — we've received your custom-size order #${id}. Our team will review the dimensions and send you a quote shortly.`,
        },
        trx
      );
    }

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
  // A quote the customer no longer wants is cancellable on the same terms as
  // an unpaid order: no money has changed hands in either case, and the
  // alternative is an unpriced order they cannot pay for and cannot remove.
  if (order.status !== 'pending_payment' && order.status !== 'pending_quote') {
    throw ApiError.badRequest('Only orders awaiting payment or a quote can be cancelled');
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

// Attaches the neon design spec to each line so the admin order page can show
// what is actually being built — dimensions, colour and the preview image —
// rather than just "Custom Neon Design #44".
//
// Two sources, in priority order:
//  1. The line's own selected_options snapshot. Authoritative, because it is
//     what was sold: the design may have been regenerated at another size
//     since, and the product may be gone entirely.
//  2. The linked design row, for lines predating that snapshot (13 of them at
//     the time of writing). Recoverable only while product_id survives —
//     it is ON DELETE SET NULL — which is exactly why (1) exists.
//
// The design row is also what supplies the preview image in both cases; a
// snapshot deliberately stores no URL, since S3 objects are purged on their
// own schedule and a frozen link would rot.
async function attachDesignSpecs(items) {
  const productIds = [...new Set(items.filter((i) => i.product_id).map((i) => i.product_id))];
  const designs = await customNeonDesignModel.findByProductIds(productIds);
  const byProductId = new Map(designs.map((d) => [d.product_id, d]));

  return Promise.all(
    items.map(async (item) => {
      const design = item.product_id ? byProductId.get(item.product_id) : null;
      const fromSnapshot = customNeonDesignService.describeSnapshotForAdmin(item.selected_options);
      if (!design && !fromSnapshot) return item;

      const fromDesign = design ? await customNeonDesignService.describeDesignForAdmin(design) : null;
      return {
        ...item,
        design: {
          ...fromDesign,
          // Snapshot values win where present; the design row fills the gaps
          // (the image, and everything for a pre-snapshot line).
          ...(fromSnapshot ?? {}),
          imageUrl: fromDesign?.imageUrl ?? null,
          designId: fromDesign?.designId ?? null,
          // Tells the UI (and a future backfill) that this line is relying on
          // the fallback rather than on its own frozen snapshot.
          resolvedFrom: fromSnapshot ? 'snapshot' : 'design',
        },
      };
    })
  );
}

async function getOrderAdmin(orderId) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  const shaped = await shapeOrder(orderId);
  const auditLog = await orderAuditLogModel.listByOrderId(orderId);
  return { ...shaped, items: await attachDesignSpecs(shaped.items), auditLog };
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
      // A quote order has NULL line prices and a 0.00 total until it is
      // priced. Letting a plain status change walk it into pending_payment
      // would expose a $0 payable order to the customer, so the only way out
      // of pending_quote (short of cancelling it) is priceQuote below, which
      // writes the prices and the status together.
      if (order.status === 'pending_quote' && newStatus !== 'cancelled') {
        throw ApiError.badRequest('Set prices for this quote before changing its status');
      }
      if (newStatus === 'pending_quote') {
        throw ApiError.badRequest('An order cannot be moved back to awaiting quote');
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

// Admin-only: puts prices on a quote order's unpriced lines and releases it
// for payment. The single exit from 'pending_quote' (migration 039) —
// applyAdjustment refuses that transition precisely so this stays the only
// path, and prices and status therefore always change together.
//
// `prices` is a map of order_item id -> unit price. Every unpriced line must
// appear in it: a partially-priced order would hand the customer a total
// that silently omits an item they are going to be sent.
async function priceQuote(orderId, prices, actorUserId) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.status !== 'pending_quote') throw ApiError.badRequest('This order is not awaiting a quote');

  const items = await orderItemModel.listByOrderId(orderId);
  const unpriced = items.filter((item) => item.item_type === 'line' && item.unit_price === null);
  if (!unpriced.length) throw ApiError.badRequest('This order has no unpriced items');

  // Validate every price before writing any of them, so a bad value in the
  // middle of the map cannot leave the order half-priced.
  const resolved = unpriced.map((item) => {
    const raw = prices?.[item.id] ?? prices?.[String(item.id)];
    const price = Number(raw);
    if (raw === undefined || raw === null || raw === '' || !Number.isFinite(price)) {
      throw ApiError.badRequest(`A price is required for item ${item.id}`);
    }
    if (price <= 0) throw ApiError.badRequest(`Price for item ${item.id} must be greater than zero`);
    return { id: item.id, productId: item.product_id, price: Math.round(price * 100) / 100 };
  });

  return db.transaction(async (trx) => {
    // eslint-disable-next-line no-restricted-syntax
    for (const line of resolved) {
      // eslint-disable-next-line no-await-in-loop
      await orderItemModel.updateUnitPrice(line.id, line.price, trx);
      // The product carries the same placeholder price and is_quote flag
      // (migration 042); clearing both keeps a re-order of this design from
      // starting another quote cycle at 0.00.
      // eslint-disable-next-line no-await-in-loop
      await productModel.setQuotedPrice(line.productId, line.price, trx);
    }

    const totals = await recomputeAndStoreTotals(orderId, trx);
    await orderModel.updateStatus(orderId, 'pending_payment', trx);
    await orderAuditLogModel.insertEntry(
      {
        orderId,
        actorUserId,
        fieldChanged: 'status',
        oldValue: 'pending_quote',
        newValue: 'pending_payment',
        reason: `Quote priced — total ${formatMoney(totals.total)}`,
      },
      trx
    );

    // The customer is told in the same transaction that prices it: a priced
    // order they were never told about would sit unpaid indefinitely.
    await customerNotificationModel.insert(
      {
        userId: order.user_id,
        type: 'quote_priced',
        orderId,
        message: `Your quote for order #${orderId} is ready — ${formatMoney(totals.total)}. You can now complete your payment.`,
      },
      trx
    );

    const auditLogEntry = (await orderAuditLogModel.listByOrderId(orderId, trx)).at(-1);
    return { order: await shapeOrder(orderId, trx), auditLogEntry };
  });
}

// Fabrication spec sheet: what the workshop needs in order to actually build
// an order, which the invoice deliberately does not carry (that is a financial
// document). One page per line item, the design preview printed large enough
// to work from, with the dimensions and colour beside it.
//
// Available for every order, including plain-product ones — those pages simply
// list the product and quantity with no design block. Unlike generateInvoice
// there is no status gate: the workshop needs this *before* the order ships,
// which is the whole point.
//
// Returns the PDFDocument without ending it, same contract as
// generateInvoice — the controller owns piping and .end().
async function generateSpecSheet(orderId) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');

  const [shaped, customer, theme] = await Promise.all([
    getOrderAdmin(orderId),
    userModel.findById(order.user_id),
    siteThemeModel.getRow(),
  ]);

  // Only real line items get a page; adjustments are financial, not physical.
  const lines = shaped.items.filter((item) => item.item_type === 'line');
  const brandName = theme?.brand_name || 'Spec Sheet';

  // Images are fetched up front: pdfkit's doc.image() is synchronous, so the
  // buffers have to exist before any page is written.
  const images = new Map();
  // eslint-disable-next-line no-restricted-syntax
  for (const line of lines) {
    if (!line.design?.designId || line.design.imagesPurgedAt) continue;
    const design = await customNeonDesignModel.findById(line.design.designId);
    if (!design?.generated_image_url) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const { buffer } = await uploadService.getObjectBuffer(design.generated_image_url);
      images.set(line.id, buffer);
    } catch (err) {
      // A missing or unreadable S3 object must not fail the whole sheet —
      // the specs below are the part the workshop cannot work without.
      console.error(`[spec-sheet] image fetch failed for design ${line.design.designId}:`, err.message);
    }
  }

  const doc = new PDFDocument({ margin: 50 });

  lines.forEach((line, index) => {
    if (index > 0) doc.addPage();

    doc.fontSize(18).font('Helvetica-Bold').text(brandName);
    doc.fontSize(14).font('Helvetica').text(`Fabrication spec sheet — Order #${order.id}`);
    doc.fontSize(9).fillColor('#666')
      .text(`Item ${index + 1} of ${lines.length}  ·  Generated ${new Date().toISOString().slice(0, 10)}`);
    doc.fillColor('#000');
    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.8);

    doc.fontSize(15).font('Helvetica-Bold').text(line.label);
    doc.moveDown(0.5);

    const image = images.get(line.id);
    if (image) {
      // fit rather than fixed width so tall/wide custom shapes keep their
      // proportions — the aspect ratio is part of the spec.
      doc.image(image, { fit: [320, 240], align: 'center' });
      doc.moveDown(0.8);
    } else if (line.design) {
      doc.fontSize(10).font('Helvetica-Oblique').fillColor('#999')
        .text(line.design.imagesPurgedAt ? '[preview image purged]' : '[preview image unavailable]');
      doc.fillColor('#000');
      doc.moveDown(0.8);
    }

    const spec = [['Quantity', String(line.quantity ?? 1)]];
    if (line.design) {
      spec.push(['Design', `#${line.design.designId ?? '—'}`]);
      if (line.design.designType) spec.push(['Source', capitalizeWord(line.design.designType)]);
      spec.push(['Size', line.design.sizeLabel ?? '—']);
      spec.push(['Dimensions', line.design.dimensions ?? '—']);
      spec.push([
        'Colour',
        // For a customer-picked colour the label IS the hex, so printing both
        // reads as "#00FFD5 (#00FFD5)". Only pair them when the label is a
        // preset name that the hex would otherwise not identify.
        line.design.colorHex && line.design.colorLabel !== line.design.colorHex
          ? `${line.design.colorLabel} (${line.design.colorHex})`
          : (line.design.colorLabel ?? line.design.colorHex ?? '—'),
      ]);
      if (line.design.isQuote) spec.push(['Pricing', 'Custom size — quoted by hand']);
    }

    doc.fontSize(11).font('Helvetica');
    spec.forEach(([label, value]) => {
      const y = doc.y;
      doc.font('Helvetica-Bold').text(label, 50, y, { width: 120 });
      doc.font('Helvetica').text(value, 175, y, { width: 375 });
      doc.moveDown(0.35);
    });

    doc.moveDown(0.8);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.6);

    doc.fontSize(11).font('Helvetica-Bold').text('Ship to');
    doc.font('Helvetica').fontSize(10);
    const address = shaped.shipping_address || {};
    [
      address.recipient_name,
      customer?.email,
      address.line1,
      address.line2,
      [address.city, address.region, address.postal_code].filter(Boolean).join(', '),
      address.country,
    ]
      .filter(Boolean)
      .forEach((part) => doc.text(part));
  });

  if (!lines.length) {
    doc.fontSize(14).text(`Order #${order.id} has no line items.`);
  }

  return doc;
}

function capitalizeWord(value) {
  const text = String(value ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
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
  priceQuote,
  generateInvoice,
  generateSpecSheet,
};
