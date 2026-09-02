// The custom-size quote flow: a cart line whose price nobody has set yet
// (products.is_quote — migration 042) must produce an order that is held at
// 'pending_quote' (039), never charged, and released only by pricing it.
//
// Same isolateDb/isolateStripe setup and rationale as order.service.test.js —
// see the comment at the top of that file.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');
const { isolateStripe } = require('./helpers/isolateStripe');
const { applySchema } = require('./helpers/testDb');

const db = isolateDb();
isolateStripe(vi);
const orderService = require('../src/services/order.service');
const paymentService = require('../src/services/payment.service');

const TABLES = [
  'contact_submissions',
  'customer_notifications',
  'notifications',
  'order_audit_log',
  'order_items',
  'orders',
  'carts',
  'custom_neon_designs',
  'product_option_choices',
  'product_option_groups',
  'product_images',
  'products',
  'site_theme',
];

const CONTACT = {
  name: 'Jo Rivera',
  email: 'JO@example.com',
  phone: '555-0142',
  message: 'Needs it before the shop opens in March.',
};

beforeEach(async () => {
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

// A confirmed custom-size design's product: price 0.00 as a placeholder
// (products.price is NOT NULL) with is_quote marking it unpriced.
async function seedQuoteProduct(overrides = {}) {
  return seedProduct({ name: 'Custom Neon Design #1', price: 0, is_quote: true, ...overrides });
}

describe('createOrder — a cart containing an unpriced custom-size item', () => {
  it('holds the order at pending_quote instead of charging it', async () => {
    const productId = await seedQuoteProduct();
    await seedCartItem(1, productId, 1);

    const order = await orderService.createOrder(1, { line1: '1 Main St', country: 'US' }, CONTACT);

    expect(order.status).toBe('pending_quote');
  });

  it('leaves the quote line unpriced so the total is 0 rather than a fake price', async () => {
    const productId = await seedQuoteProduct();
    await seedCartItem(1, productId, 1);

    const order = await orderService.createOrder(1, { line1: 'x', country: 'US' }, CONTACT);

    const line = order.items.find((item) => item.item_type === 'line');
    // NULL, not 0 — "we have not priced this" rather than "this is free".
    expect(line.unit_price).toBeNull();
    expect(order.subtotal).toBe(0);
    expect(order.total).toBe(0);
  });

  it('counts only the priced lines in the subtotal of a mixed cart', async () => {
    const normal = await seedProduct({ name: 'Wall sign', price: 40, stock_quantity: 10 });
    const quoted = await seedQuoteProduct();
    await seedCartItem(2, normal, 2); // 80
    await seedCartItem(2, quoted, 1); // unpriced

    const order = await orderService.createOrder(2, { line1: 'x', country: 'US' }, CONTACT);

    expect(order.status).toBe('pending_quote');
    expect(order.subtotal).toBeCloseTo(80);
    expect(order.items.filter((i) => i.item_type === 'line')).toHaveLength(2);
  });

  it('records the enquiry the admin works from, normalising the email', async () => {
    const productId = await seedQuoteProduct();
    await seedCartItem(3, productId, 1);

    const order = await orderService.createOrder(3, { line1: 'x', country: 'US' }, CONTACT);

    const [submission] = await db('contact_submissions').select('*');
    expect(submission).toMatchObject({
      topic: 'quote_request',
      user_id: 3,
      name: 'Jo Rivera',
      email: 'jo@example.com',
      phone: '555-0142',
    });
    // The order number has to be in the message: it is what makes the
    // enquiry actionable from the admin Contact list alone.
    expect(submission.message).toContain(`#${order.id}`);
  });

  it('notifies the admin and the customer in the same write as the order', async () => {
    const productId = await seedQuoteProduct();
    await seedCartItem(4, productId, 1);

    const order = await orderService.createOrder(4, { line1: 'x', country: 'US' }, CONTACT);

    const adminNotifications = await db('notifications').select('*');
    expect(adminNotifications).toHaveLength(1);
    expect(adminNotifications[0].type).toBe('quote_requested');

    const customerNotifications = await db('customer_notifications').select('*');
    expect(customerNotifications).toHaveLength(1);
    expect(customerNotifications[0]).toMatchObject({
      user_id: 4,
      type: 'quote_requested',
      order_id: order.id,
    });
  });

  it('rejects the checkout when contact details are missing or invalid', async () => {
    const productId = await seedQuoteProduct();
    await seedCartItem(5, productId, 1);
    const address = { line1: 'x', country: 'US' };

    await expect(orderService.createOrder(5, address)).rejects.toThrow('Contact details are required');
    await expect(
      orderService.createOrder(5, address, { ...CONTACT, email: 'not-an-email' })
    ).rejects.toThrow('valid email address');
    await expect(orderService.createOrder(5, address, { ...CONTACT, phone: '' })).rejects.toThrow(
      'Phone is required'
    );

    // Nothing was written by any of the three rejected attempts.
    expect(await db('orders').select('*')).toHaveLength(0);
    expect(await db('contact_submissions').select('*')).toHaveLength(0);
  });

  it('leaves an ordinary cart on the normal pay-now path', async () => {
    const productId = await seedProduct({ price: 25, stock_quantity: 5 });
    await seedCartItem(6, productId, 1);

    const order = await orderService.createOrder(6, { line1: 'x', country: 'US' });

    expect(order.status).toBe('pending_payment');
    expect(order.total).toBeCloseTo(25);
    // No enquiry and no notifications for a normal order.
    expect(await db('contact_submissions').select('*')).toHaveLength(0);
    expect(await db('customer_notifications').select('*')).toHaveLength(0);
  });
});

describe('payment — an unpriced order can never reach Stripe', () => {
  it('refuses to create a PaymentIntent while the order is pending_quote', async () => {
    const productId = await seedQuoteProduct();
    await seedCartItem(7, productId, 1);
    const order = await orderService.createOrder(7, { line1: 'x', country: 'US' }, CONTACT);

    await expect(
      paymentService.createOrReusePaymentIntent(order.id, { id: 7, role: 'customer' })
    ).rejects.toThrow('awaiting a quote');
  });
});

describe('priceQuote — the only way out of pending_quote', () => {
  async function seedQuoteOrder(userId = 8) {
    const productId = await seedQuoteProduct();
    await seedCartItem(userId, productId, 1);
    const order = await orderService.createOrder(userId, { line1: 'x', country: 'US' }, CONTACT);
    const [line] = await db('order_items').where({ order_id: order.id, item_type: 'line' });
    return { order, line, productId };
  }

  it('writes the prices, recomputes the total and releases the order for payment', async () => {
    const { order, line } = await seedQuoteOrder();

    const result = await orderService.priceQuote(order.id, { [line.id]: 349.5 }, 1);

    expect(result.order.status).toBe('pending_payment');
    expect(result.order.subtotal).toBeCloseTo(349.5);
    expect(result.order.total).toBeCloseTo(349.5);
  });

  it('clears is_quote on the product so a re-order is not quoted again', async () => {
    const { order, line, productId } = await seedQuoteOrder(9);

    await orderService.priceQuote(order.id, { [line.id]: 200 }, 1);

    const product = await db('products').where({ id: productId }).first();
    expect(Number(product.price)).toBeCloseTo(200);
    expect(Boolean(product.is_quote)).toBe(false);
  });

  it('tells the customer their quote is ready', async () => {
    const { order, line } = await seedQuoteOrder(10);

    await orderService.priceQuote(order.id, { [line.id]: 120 }, 1);

    const notifications = await db('customer_notifications').where({ type: 'quote_priced' });
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ user_id: 10, order_id: order.id });
    expect(notifications[0].message).toContain('$120.00');
  });

  it('records the transition in the audit log', async () => {
    const { order, line } = await seedQuoteOrder(11);

    await orderService.priceQuote(order.id, { [line.id]: 75 }, 42);

    const [entry] = await db('order_audit_log').where({ order_id: order.id }).orderBy('id', 'desc');
    expect(entry).toMatchObject({
      field_changed: 'status',
      old_value: 'pending_quote',
      new_value: 'pending_payment',
      actor_user_id: 42,
    });
  });

  it('rejects a partial or nonsensical price map without changing the order', async () => {
    const { order, line } = await seedQuoteOrder(12);

    await expect(orderService.priceQuote(order.id, {}, 1)).rejects.toThrow('price is required');
    await expect(orderService.priceQuote(order.id, { [line.id]: 0 }, 1)).rejects.toThrow(
      'greater than zero'
    );
    await expect(orderService.priceQuote(order.id, { [line.id]: 'abc' }, 1)).rejects.toThrow(
      'price is required'
    );

    const untouched = await db('orders').where({ id: order.id }).first();
    expect(untouched.status).toBe('pending_quote');
    const stillUnpriced = await db('order_items').where({ id: line.id }).first();
    expect(stillUnpriced.unit_price).toBeNull();
  });

  it('rejects pricing an order that is not awaiting a quote', async () => {
    const productId = await seedProduct({ price: 30, stock_quantity: 5 });
    await seedCartItem(13, productId, 1);
    const order = await orderService.createOrder(13, { line1: 'x', country: 'US' });

    await expect(orderService.priceQuote(order.id, {}, 1)).rejects.toThrow('not awaiting a quote');
  });
});

describe('status changes on a quote order', () => {
  async function seedQuoteOrder(userId) {
    const productId = await seedQuoteProduct();
    await seedCartItem(userId, productId, 1);
    return orderService.createOrder(userId, { line1: 'x', country: 'US' }, CONTACT);
  }

  it('refuses a bare status change into pending_payment (that would expose a $0 order)', async () => {
    const order = await seedQuoteOrder(14);

    await expect(
      orderService.applyAdjustment(order.id, { type: 'status_change', newStatus: 'pending_payment' }, 1)
    ).rejects.toThrow('Set prices for this quote');
  });

  it('still allows cancelling an unwanted quote', async () => {
    const order = await seedQuoteOrder(15);

    await orderService.applyAdjustment(order.id, { type: 'status_change', newStatus: 'cancelled' }, 1);

    const updated = await db('orders').where({ id: order.id }).first();
    expect(updated.status).toBe('cancelled');
  });

  it('lets the customer cancel their own pending quote', async () => {
    const order = await seedQuoteOrder(16);

    await orderService.cancelOrder(order.id, { id: 16, role: 'customer' });

    expect(await db('orders').where({ id: order.id }).first()).toBeUndefined();
  });

  it('never moves an order back into pending_quote', async () => {
    const productId = await seedProduct({ price: 30, stock_quantity: 5 });
    await seedCartItem(17, productId, 1);
    const order = await orderService.createOrder(17, { line1: 'x', country: 'US' });

    await expect(
      orderService.applyAdjustment(order.id, { type: 'status_change', newStatus: 'pending_quote' }, 1)
    ).rejects.toThrow('cannot be moved back');
  });
});

// What actually lands on the order line: the attributes have to survive
// checkout, and stay readable if the product row is later deleted
// (order_items.product_id is ON DELETE SET NULL).
describe('order lines carry the neon size, dimensions and colour', () => {
  const neonService = require('../src/services/customNeonDesign.service');
  const cartService = require('../src/services/cart.service');
  const identity = { user: { id: 20 }, anonSessionId: null };

  async function orderNeonLine(designRow, { isQuote = false } = {}) {
    const [productId] = await db('products').insert({
      category_id: 1,
      name: 'Custom Neon Design #7',
      price: isQuote ? 0 : 524.99,
      is_quote: isQuote,
      stock_quantity: 9999,
    });
    await cartService.addItem(identity, productId, 1, null, neonService.buildNeonSnapshot(designRow));
    const order = await orderService.createOrder(
      20,
      { line1: 'x', country: 'US' },
      isQuote ? CONTACT : undefined
    );
    const line = await db('order_items').where({ order_id: order.id, item_type: 'line' }).first();
    return {
      label: line.label,
      selectedOptions: JSON.parse(line.selected_options),
      productId,
    };
  }

  it('spells the dimensions and colour out in the line label', async () => {
    const { label } = await orderNeonLine({ size: 'large', neon_color: 'ice-blue' });

    expect(label).toBe('Custom Neon Design #7 — 36"x36", Ice Blue');
  });

  it('uses the hex code in the label for a customer-picked colour', async () => {
    const { label } = await orderNeonLine({
      size: 'custom',
      neon_color: 'custom:#ff2d95',
      custom_width_in: 48,
      custom_height_in: 18,
    }, { isQuote: true });

    expect(label).toBe('Custom Neon Design #7 — 48"x18", #FF2D95');
  });

  it('stores the structured snapshot alongside the label', async () => {
    const { selectedOptions } = await orderNeonLine({ size: 'medium', neon_color: 'pink' });

    expect(selectedOptions.choices).toEqual([
      expect.objectContaining({ groupKey: 'neon_size', choiceLabel: 'Medium' }),
      expect.objectContaining({ groupKey: 'neon_dimensions', choiceLabel: '24"x24"' }),
      expect.objectContaining({ groupKey: 'neon_color', choiceLabel: 'Pink' }),
    ]);
  });

  it('survives the product being deleted', async () => {
    const { productId } = await orderNeonLine({ size: 'large', neon_color: 'ice-blue' });

    // ON DELETE SET NULL: the line loses its product but must not lose what
    // was bought. This is the whole reason the snapshot exists.
    await db('order_items').where({ product_id: productId }).update({ product_id: null });
    await db('products').where({ id: productId }).del();

    const line = await db('order_items').where({ item_type: 'line' }).first();
    expect(line.product_id).toBeNull();
    expect(line.label).toContain('36"x36"');
    expect(line.label).toContain('Ice Blue');
    expect(JSON.parse(line.selected_options).choices).toHaveLength(3);
  });

  it('does not add a stray fee line for the descriptive choices', async () => {
    await orderNeonLine({ size: 'large', neon_color: 'ice-blue' });

    // Only the design itself — priceDelta 0 means no flat-fee split-out.
    const lines = await db('order_items').where({ item_type: 'line' });
    expect(lines).toHaveLength(1);
  });

  it('leaves a plain product’s label untouched', async () => {
    const productId = await seedProduct({ name: 'Wall sign', price: 40, stock_quantity: 10 });
    await seedCartItem(21, productId, 1);

    const order = await orderService.createOrder(21, { line1: 'x', country: 'US' });

    const line = await db('order_items').where({ order_id: order.id, item_type: 'line' }).first();
    expect(line.label).toBe('Wall sign');
    expect(line.selected_options).toBeNull();
  });
});
