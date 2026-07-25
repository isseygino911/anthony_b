// Path 2/4: order total derivation — architecture.md §7.1.
// Path 3/4 (integration angle): low-stock threshold crossing — architecture.md §7.2.
//
// order.service.js calls `db.transaction(...)` on the module-level `db` it
// imports from `config/db` at require-time, so (unlike cart.service, whose
// merge function takes `trx` as an explicit argument) we can't just hand it
// an in-memory transaction directly. `vi.mock('../src/config/db', ...)` was
// tried first and found unreliable: order.service.js and its model
// dependencies are plain CommonJS files reached via nested `require()`
// calls, and those calls kept resolving to the REAL config/db.js (confirmed
// by an actual query error surfacing the live remote schema name) even with
// the mock registered. See tests/helpers/isolateDb.js for the safe
// replacement (pre-populates Node's own require.cache), which was verified
// end-to-end before use here.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');
const { applySchema } = require('./helpers/testDb');

const db = isolateDb(); // must happen before requiring order.service below
const orderService = require('../src/services/order.service');

const TABLES = [
  'notifications',
  'order_audit_log',
  'order_items',
  'orders',
  'carts',
  'custom_neon_designs',
  'product_images',
  'products',
  'site_theme',
];

beforeEach(async () => {
  // Fresh tables per test, same in-memory database handle.
  // eslint-disable-next-line no-restricted-syntax
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await db.schema.dropTableIfExists(table);
  }
  await applySchema(db);
});

afterAll(async () => {
  await db.destroy();
});

async function seedProduct(overrides = {}) {
  const [id] = await db('products').insert({
    category_id: 1,
    name: 'Widget',
    price: 10,
    stock_quantity: 100,
    low_stock_threshold: null,
    ...overrides,
  });
  return id;
}

async function seedCartItem(userId, productId, quantity) {
  await db('carts').insert({ user_id: userId, product_id: productId, quantity, added_at: new Date() });
}

describe('order.service — total derivation (architecture.md §7.1)', () => {
  it('createOrder computes subtotal = SUM(unit_price*quantity), adjustment_total = 0, total = subtotal', async () => {
    const productId = await seedProduct({ price: 12.5, stock_quantity: 50 });
    await seedCartItem(1, productId, 3);

    const order = await orderService.createOrder(1, { line1: '1 Main St', country: 'US' });

    expect(order.subtotal).toBeCloseTo(37.5); // 12.5 * 3
    expect(order.adjustment_total).toBe(0);
    expect(order.total).toBeCloseTo(37.5);
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ item_type: 'line', quantity: 3 });
  });

  it('createOrder sums multiple line items into one subtotal', async () => {
    const p1 = await seedProduct({ name: 'A', price: 10, stock_quantity: 20 });
    const p2 = await seedProduct({ name: 'B', price: 5, stock_quantity: 20 });
    await seedCartItem(2, p1, 2); // 20
    await seedCartItem(2, p2, 4); // 20

    const order = await orderService.createOrder(2, { line1: 'x', country: 'US' });

    expect(order.subtotal).toBeCloseTo(40);
    expect(order.total).toBeCloseTo(40);
  });

  it('rejects checkout with an empty cart', async () => {
    await expect(orderService.createOrder(3, { line1: 'x', country: 'US' })).rejects.toThrow(
      'Cart is empty'
    );
  });

  it('applyAdjustment (discount) recomputes adjustment_total and total, never lets the API set total directly', async () => {
    const productId = await seedProduct({ price: 100, stock_quantity: 10 });
    await seedCartItem(4, productId, 1);
    const order = await orderService.createOrder(4, { line1: 'x', country: 'US' });
    expect(order.total).toBeCloseTo(100);

    const { order: updated, auditLogEntry } = await orderService.applyAdjustment(
      order.id,
      { type: 'discount', amount: -20, reason: 'loyalty discount' },
      /* actorUserId */ 99
    );

    expect(updated.subtotal).toBeCloseTo(100); // line items untouched
    expect(updated.adjustment_total).toBeCloseTo(-20);
    expect(updated.total).toBeCloseTo(80); // subtotal + adjustment_total
    expect(auditLogEntry).toMatchObject({ field_changed: 'total', new_value: '80' });
  });

  it('applyAdjustment (discount) normalizes a positive amount to negative, never increasing the total', async () => {
    const productId = await seedProduct({ price: 100, stock_quantity: 10 });
    await seedCartItem(13, productId, 1);
    const order = await orderService.createOrder(13, { line1: 'x', country: 'US' });
    expect(order.total).toBeCloseTo(100);

    const { order: updated, auditLogEntry } = await orderService.applyAdjustment(
      order.id,
      { type: 'discount', amount: 20, reason: 'loyalty discount' },
      /* actorUserId */ 99
    );

    expect(updated.subtotal).toBeCloseTo(100); // line items untouched
    expect(updated.adjustment_total).toBeCloseTo(-20); // normalized to negative, not +20
    expect(updated.total).toBeCloseTo(80); // subtotal + adjustment_total
    expect(auditLogEntry).toMatchObject({ field_changed: 'total', new_value: '80' });
  });

  it('applyAdjustment accumulates multiple adjustment rows into adjustment_total (not just the latest one)', async () => {
    const productId = await seedProduct({ price: 50, stock_quantity: 10 });
    await seedCartItem(5, productId, 2); // subtotal 100
    const order = await orderService.createOrder(5, { line1: 'x', country: 'US' });

    await orderService.applyAdjustment(order.id, { type: 'discount', amount: -10 }, 1);
    const { order: afterSecond } = await orderService.applyAdjustment(
      order.id,
      { type: 'shipping_change', amount: 15 },
      1
    );

    expect(afterSecond.adjustment_total).toBeCloseTo(5); // -10 + 15
    expect(afterSecond.total).toBeCloseTo(105); // 100 + 5
  });

  it('applyAdjustment with type=status_change updates status and leaves totals untouched', async () => {
    const productId = await seedProduct({ price: 30, stock_quantity: 10 });
    await seedCartItem(6, productId, 1);
    const order = await orderService.createOrder(6, { line1: 'x', country: 'US' });

    const { order: updated, auditLogEntry } = await orderService.applyAdjustment(
      order.id,
      { type: 'status_change', newStatus: 'processing', reason: 'paid' },
      1
    );

    expect(updated.status).toBe('processing');
    expect(updated.total).toBeCloseTo(30); // unchanged
    expect(auditLogEntry).toMatchObject({ field_changed: 'status', old_value: 'pending_payment', new_value: 'processing' });
  });

  it('rejects a money-affecting adjustment type without a numeric amount', async () => {
    const productId = await seedProduct({ price: 30, stock_quantity: 10 });
    await seedCartItem(7, productId, 1);
    const order = await orderService.createOrder(7, { line1: 'x', country: 'US' });

    await expect(
      orderService.applyAdjustment(order.id, { type: 'shipping_change' }, 1)
    ).rejects.toThrow('amount is required');
  });

  // Refunds are temporarily disabled (see order.service.js) — unlike
  // discount, nothing normalizes a refund's sign, so a positive amount would
  // silently increase the total instead of reducing it. Re-enable this type
  // once that's fixed.
  it('rejects a refund adjustment regardless of amount, since refunds are temporarily disabled', async () => {
    const productId = await seedProduct({ price: 30, stock_quantity: 10 });
    await seedCartItem(9, productId, 1);
    const order = await orderService.createOrder(9, { line1: 'x', country: 'US' });

    await expect(
      orderService.applyAdjustment(order.id, { type: 'refund', amount: -10 }, 1)
    ).rejects.toThrow('temporarily disabled');
  });

  it('rejects an unknown adjustment type', async () => {
    const productId = await seedProduct({ price: 30, stock_quantity: 10 });
    await seedCartItem(8, productId, 1);
    const order = await orderService.createOrder(8, { line1: 'x', country: 'US' });

    await expect(
      orderService.applyAdjustment(order.id, { type: 'bogus', amount: -1 }, 1)
    ).rejects.toThrow('Unknown adjustment type');
  });
});

describe('order.service — stock decrement + low-stock notification (architecture.md §7.2)', () => {
  it('decrements stock_quantity per line item and inserts exactly one notification when the order crosses the threshold', async () => {
    const productId = await seedProduct({ price: 10, stock_quantity: 7, low_stock_threshold: 5 });
    await seedCartItem(10, productId, 3); // 7 -> 4, crosses below threshold 5

    await orderService.createOrder(10, { line1: 'x', country: 'US' });

    const product = await db('products').where({ id: productId }).first();
    expect(product.stock_quantity).toBe(4);

    const notifications = await db('notifications').where({ product_id: productId });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('low_stock');
    expect(notifications[0].message).toContain('4 remaining');
  });

  it('does not notify when stock stays above threshold', async () => {
    const productId = await seedProduct({ price: 10, stock_quantity: 50, low_stock_threshold: 5 });
    await seedCartItem(11, productId, 1); // 50 -> 49, nowhere near threshold

    await orderService.createOrder(11, { line1: 'x', country: 'US' });

    const notifications = await db('notifications').where({ product_id: productId });
    expect(notifications).toHaveLength(0);
  });

  it('does not re-notify on a later order once stock is already below threshold (only the crossing order notifies)', async () => {
    const productId = await seedProduct({ price: 10, stock_quantity: 4, low_stock_threshold: 5 });
    await seedCartItem(12, productId, 1); // 4 -> 3, already below threshold before this order

    await orderService.createOrder(12, { line1: 'x', country: 'US' });

    const notifications = await db('notifications').where({ product_id: productId });
    expect(notifications).toHaveLength(0); // oldQuantity (4) was not > threshold (5), so this isn't "the crossing order"
  });
});

describe('order.service — cancelOrder (customer self-cancel of an unpaid order)', () => {
  it('restores stock and deletes the order + its items for a pending_payment order', async () => {
    const productId = await seedProduct({ price: 10, stock_quantity: 7 });
    await seedCartItem(20, productId, 3); // 7 -> 4
    const order = await orderService.createOrder(20, { line1: 'x', country: 'US' });

    const product = await db('products').where({ id: productId }).first();
    expect(product.stock_quantity).toBe(4);

    await orderService.cancelOrder(order.id, { id: 20, role: 'customer' });

    const restored = await db('products').where({ id: productId }).first();
    expect(restored.stock_quantity).toBe(7);

    const deletedOrder = await db('orders').where({ id: order.id }).first();
    expect(deletedOrder).toBeUndefined();
    const items = await db('order_items').where({ order_id: order.id });
    expect(items).toHaveLength(0);
  });

  it('rejects cancelling another user\'s order', async () => {
    const productId = await seedProduct({ price: 10, stock_quantity: 10 });
    await seedCartItem(21, productId, 1);
    const order = await orderService.createOrder(21, { line1: 'x', country: 'US' });

    await expect(
      orderService.cancelOrder(order.id, { id: 999, role: 'customer' })
    ).rejects.toThrow('Order not found');
  });

  it('rejects cancelling an order that already left pending_payment', async () => {
    const productId = await seedProduct({ price: 10, stock_quantity: 10 });
    await seedCartItem(22, productId, 1);
    const order = await orderService.createOrder(22, { line1: 'x', country: 'US' });
    await orderService.applyAdjustment(order.id, { type: 'status_change', newStatus: 'processing' }, 1);

    await expect(
      orderService.cancelOrder(order.id, { id: 22, role: 'customer' })
    ).rejects.toThrow('Only orders awaiting payment can be cancelled');
  });

  it('rejects cancelling a non-existent order', async () => {
    await expect(
      orderService.cancelOrder(999999, { id: 1, role: 'customer' })
    ).rejects.toThrow('Order not found');
  });
});

describe('order.service — generateInvoice guard', () => {
  it('rejects generating an invoice for an order that is not yet delivered', async () => {
    const productId = await seedProduct({ price: 20, stock_quantity: 10 });
    await seedCartItem(14, productId, 1);
    const order = await orderService.createOrder(14, { line1: 'x', country: 'US' });
    expect(order.status).toBe('pending_payment');

    await expect(orderService.generateInvoice(order.id)).rejects.toThrow(
      'Invoice is only available once the order is delivered'
    );
  });

  it('rejects generating an invoice for a non-existent order', async () => {
    await expect(orderService.generateInvoice(999999)).rejects.toThrow('Order not found');
  });
});
