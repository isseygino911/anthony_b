// customNeonDesign.service.js — confirmDesign mints a synthetic, hidden
// product from a 'ready' design and reuses cart.service.addItem() completely
// unmodified (see plan: "Key design decision" in the neon designer feature).
// Covers price-by-size, the minted product's hidden/purchasable shape, the
// design row being stamped with product_id, and ownership gating for
// anonymous (session-based) vs. logged-in callers.
//
// confirmDesign calls `db.transaction(...)` on the module-level `db` from
// config/db, so this uses isolateDb() the same way order.service.test.js
// does, rather than mocking — see tests/helpers/isolateDb.js for why.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the service below
const customNeonDesignService = require('../src/services/customNeonDesign.service');

const TABLES = ['custom_neon_designs', 'product_images', 'products', 'categories', 'carts'];

async function resetSchema() {
  // eslint-disable-next-line no-restricted-syntax
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await db.schema.dropTableIfExists(table);
  }

  await db.schema.createTable('categories', (t) => {
    t.increments('id');
    t.string('name');
    t.string('slug');
    t.boolean('is_internal').defaultTo(false);
    t.datetime('created_at');
  });

  await db.schema.createTable('products', (t) => {
    t.increments('id');
    t.integer('category_id');
    t.string('name');
    t.text('description');
    t.decimal('price', 10, 2);
    t.string('sku');
    t.json('tags').nullable();
    t.integer('stock_quantity').defaultTo(0);
    t.integer('low_stock_threshold').nullable();
    t.boolean('is_featured').defaultTo(false);
    t.boolean('is_bestseller').defaultTo(false);
    t.boolean('is_clearance').defaultTo(false);
    t.boolean('is_active').notNullable().defaultTo(true);
    t.datetime('deleted_at').nullable();
    t.datetime('created_at');
    t.datetime('updated_at');
  });

  await db.schema.createTable('product_images', (t) => {
    t.increments('id');
    t.integer('product_id');
    t.string('url');
    t.boolean('is_primary').defaultTo(false);
    t.integer('sort_order').defaultTo(0);
    t.datetime('created_at');
  });

  await db.schema.createTable('carts', (t) => {
    t.increments('cart_id');
    t.string('session_id').nullable();
    t.integer('user_id').nullable();
    t.integer('product_id');
    t.integer('quantity');
    t.datetime('added_at');
  });

  await db.schema.createTable('custom_neon_designs', (t) => {
    t.increments('id');
    t.integer('user_id').nullable();
    t.string('session_id').nullable();
    t.string('design_type');
    t.json('input_payload');
    t.string('size').nullable();
    t.string('neon_color').nullable();
    t.decimal('price', 10, 2).nullable();
    t.string('status').defaultTo('pending');
    t.integer('attempts').defaultTo(0);
    t.text('last_error').nullable();
    t.string('generated_image_url').nullable();
    t.integer('product_id').nullable();
    t.text('admin_notes').nullable();
    t.datetime('images_purged_at').nullable();
    t.datetime('created_at');
    t.datetime('updated_at');
  });
}

beforeEach(async () => {
  await resetSchema();
  await db('categories').insert({ name: 'Custom Neon Signs', slug: 'custom-neon-signs', is_internal: true, created_at: new Date() });
});

afterAll(async () => {
  await db.destroy();
});

async function seedDesign(overrides = {}) {
  const now = new Date();
  const [id] = await db('custom_neon_designs').insert({
    user_id: null,
    session_id: 'anon-session-1',
    design_type: 'draw',
    input_payload: JSON.stringify({ strokes: [], renderedImageUrl: 'https://bucket.s3.us-east-1.amazonaws.com/custom-neon/source/abc.png' }),
    size: 'medium',
    neon_color: 'pink',
    status: 'ready',
    attempts: 0,
    generated_image_url: 'https://bucket.s3.us-east-1.amazonaws.com/custom-neon/generated/abc.png',
    created_at: now,
    updated_at: now,
    ...overrides,
  });
  return id;
}

const anonIdentity = { user: null, anonSessionId: 'anon-session-1' };

describe('customNeonDesign.service.confirmDesign', () => {
  it('mints a hidden product priced by size, links it back to the design, and adds it to the cart', async () => {
    const id = await seedDesign();

    const { design, cart } = await customNeonDesignService.confirmDesign(id, anonIdentity);

    expect(design.status).toBe('ready');
    expect(design.price).toBe(249);
    expect(design.productId).toBeTruthy();

    const product = await db('products').where({ id: design.productId }).first();
    expect(Number(product.price)).toBe(249);
    expect(product).toMatchObject({ is_active: 0, sku: `NEON-${id}` });

    const image = await db('product_images').where({ product_id: design.productId }).first();
    expect(image.url).toBe('https://bucket.s3.us-east-1.amazonaws.com/custom-neon/generated/abc.png');
    expect(image.is_primary).toBe(1);

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({ productId: design.productId, quantity: 1 });
  });

  it('rejects confirming a design that is not yet ready', async () => {
    const id = await seedDesign({ status: 'processing', generated_image_url: null });

    await expect(customNeonDesignService.confirmDesign(id, anonIdentity)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects confirming a design whose stored size is invalid (e.g. never actually generated with one)', async () => {
    const id = await seedDesign({ size: null, neon_color: null });

    await expect(customNeonDesignService.confirmDesign(id, anonIdentity)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('rejects confirming a design owned by a different anonymous session', async () => {
    const id = await seedDesign({ session_id: 'someone-elses-session' });

    await expect(customNeonDesignService.confirmDesign(id, anonIdentity)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('prices small/large tiers per the reference mockup, using the size stored on the design (set at generation time)', async () => {
    const smallId = await seedDesign({ size: 'small', neon_color: 'blue' });
    const { design: small } = await customNeonDesignService.confirmDesign(smallId, anonIdentity);
    expect(small.price).toBe(149);

    const largeId = await seedDesign({ session_id: 'anon-session-1', size: 'large', neon_color: 'white' });
    const { design: large } = await customNeonDesignService.confirmDesign(largeId, anonIdentity);
    expect(large.price).toBe(349);
  });
});

describe('customNeonDesign.service.regenerate — size/color changes before re-running', () => {
  it('updates size and neon_color and re-queues when both are provided', async () => {
    const id = await seedDesign({ size: 'small', neon_color: 'amber', status: 'failed', attempts: 2 });

    const design = await customNeonDesignService.regenerate(id, anonIdentity, { size: 'large', neonColor: 'blue' });

    expect(design.status).toBe('pending');
    expect(design.attempts).toBe(0);
    expect(design.size).toBe('large');
    expect(design.neonColor).toBe('blue');
  });

  it('keeps the existing size/color when regenerate is called without new values', async () => {
    const id = await seedDesign({ size: 'small', neon_color: 'amber', status: 'ready' });

    const design = await customNeonDesignService.regenerate(id, anonIdentity);

    expect(design.status).toBe('pending');
    expect(design.size).toBe('small');
    expect(design.neonColor).toBe('amber');
  });
});

describe('customNeonDesign.service.getDesign / regenerate — ownership gating', () => {
  it('allows the owning anonymous session to read its own design', async () => {
    const id = await seedDesign();
    const design = await customNeonDesignService.getDesign(id, anonIdentity);
    expect(design.id).toBe(id);
  });

  it('hides a design belonging to a different session behind a 404', async () => {
    const id = await seedDesign({ session_id: 'someone-elses-session' });
    await expect(customNeonDesignService.getDesign(id, anonIdentity)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('lets an admin read any design regardless of ownership', async () => {
    const id = await seedDesign({ session_id: 'someone-elses-session' });
    const design = await customNeonDesignService.getDesign(id, { user: { id: 1, role: 'admin' }, anonSessionId: null });
    expect(design.id).toBe(id);
  });

  it('regenerate resets status to pending and clears attempts', async () => {
    const id = await seedDesign({ status: 'failed', attempts: 3, last_error: 'boom' });
    const design = await customNeonDesignService.regenerate(id, anonIdentity);
    expect(design.status).toBe('pending');
    expect(design.attempts).toBe(0);
    expect(design.lastError).toBeNull();
  });
});
