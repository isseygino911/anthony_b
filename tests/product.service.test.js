// product.service.js — is_active reversible take-down flag, introduced by
// migrations/021_add_products_is_active.js. Disabled products are invisible
// in product-list/detail views to EVERY caller, admin included — the admin
// role only lifts that gate when the caller also explicitly opts in via
// includeInactive (the dedicated admin management screens), so an admin
// merely browsing the storefront sees exactly what a customer sees. Covers
// baseQuery gating (model), getProductDetail's 404 branch, shapeProduct's
// admin-only field exposure, and setProductActive's enable/disable round-trip.
//
// config/db is isolated the same way order.service.test.js does it (real
// in-memory better-sqlite3, local schema) so no real MySQL connection is
// ever attempted. syncEmbeddingNonFatal/syncSeoNonFatal are exercised for
// real (not stubbed) because they're no-ops/fast local inserts here:
// GEMINI_API_KEY is unset in the test env so geminiIsConfigured is false
// (syncEmbeddingNonFatal short-circuits before any network call), and
// syncSeoNonFatal only does a local product_seo insert — but neither is
// invoked by the functions under test in this file (listProducts,
// getProductDetail, setProductActive), so product_seo isn't even needed.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring product.service below
const productService = require('../src/services/product.service');

const TABLES = ['product_group_items', 'product_images', 'products'];

async function resetSchema() {
  // eslint-disable-next-line no-restricted-syntax
  for (const table of TABLES) {
    // eslint-disable-next-line no-await-in-loop
    await db.schema.dropTableIfExists(table);
  }

  await db.schema.createTable('products', (t) => {
    t.increments('id');
    t.integer('category_id');
    t.string('name');
    t.text('description');
    t.decimal('price', 10, 2);
    t.string('sku');
    t.json('tags').nullable();
    t.integer('stock_quantity');
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

  await db.schema.createTable('product_group_items', (t) => {
    t.increments('id');
    t.integer('group_id');
    t.integer('product_id');
  });
}

beforeEach(async () => {
  await resetSchema();
});

afterAll(async () => {
  await db.destroy();
});

async function seedProduct(overrides = {}) {
  const now = new Date();
  const [id] = await db('products').insert({
    category_id: 1,
    name: 'Widget',
    description: 'A widget',
    price: 10,
    sku: `SKU-${Math.random().toString(36).slice(2, 8)}`,
    stock_quantity: 25,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
  return id;
}

describe('product.service — public/admin visibility split for is_active (architecture.md §8)', () => {
  it('(a) listProducts as a non-admin excludes a disabled product', async () => {
    const activeId = await seedProduct({ name: 'Active One' });
    const disabledId = await seedProduct({ name: 'Disabled One', is_active: false });

    const result = await productService.listProducts({}, { isAdmin: false });

    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(activeId);
    expect(ids).not.toContain(disabledId);
    expect(result.total).toBe(1);
  });

  it('(c) listProducts as an admin excludes the disabled product by default (role alone is not enough)', async () => {
    const disabledId = await seedProduct({ name: 'Disabled One', is_active: false });

    const result = await productService.listProducts({}, { isAdmin: true });

    expect(result.items.map((p) => p.id)).not.toContain(disabledId);
  });

  it('(c2) listProducts as an admin with includeInactive=true includes the disabled product, shaped with is_active: false', async () => {
    const disabledId = await seedProduct({ name: 'Disabled One', is_active: false });

    const result = await productService.listProducts({ includeInactive: 'true' }, { isAdmin: true });

    const found = result.items.find((p) => p.id === disabledId);
    expect(found).toBeDefined();
    expect(found.is_active).toBe(false);
  });

  it('(c3) listProducts with includeInactive=true but isAdmin false still excludes the disabled product', async () => {
    const disabledId = await seedProduct({ name: 'Disabled One', is_active: false });

    const result = await productService.listProducts({ includeInactive: 'true' }, { isAdmin: false });

    expect(result.items.map((p) => p.id)).not.toContain(disabledId);
  });

  it('(g) is_active is never present on a non-admin listProducts item, even for an active product', async () => {
    await seedProduct({ name: 'Active One' });

    const result = await productService.listProducts({}, { isAdmin: false });

    expect(result.items[0]).not.toHaveProperty('is_active');
    expect(result.items[0]).not.toHaveProperty('stock_quantity');
  });

  it('(b) getProductDetail throws notFound for a non-admin on a disabled product', async () => {
    const disabledId = await seedProduct({ is_active: false });

    await expect(productService.getProductDetail(disabledId, { isAdmin: false })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('(c) getProductDetail as an admin throws notFound by default (role alone is not enough)', async () => {
    const disabledId = await seedProduct({ is_active: false });

    await expect(productService.getProductDetail(disabledId, { isAdmin: true })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('(c2) getProductDetail as an admin with includeInactive=true still returns the product, with is_active: false', async () => {
    const disabledId = await seedProduct({ is_active: false });

    const product = await productService.getProductDetail(disabledId, { isAdmin: true, includeInactive: true });

    expect(product.id).toBe(disabledId);
    expect(product.is_active).toBe(false);
  });

  it('(d) setProductActive(id, false) then (id, true) round-trips visibility for public list + detail', async () => {
    const id = await seedProduct({ name: 'Toggle Me' });

    // Disable.
    const disabled = await productService.setProductActive(id, false);
    expect(disabled.is_active).toBe(false);

    let publicList = await productService.listProducts({}, { isAdmin: false });
    expect(publicList.items.map((p) => p.id)).not.toContain(id);
    await expect(productService.getProductDetail(id, { isAdmin: false })).rejects.toMatchObject({
      statusCode: 404,
    });

    // Re-enable ("repost").
    const enabled = await productService.setProductActive(id, true);
    expect(enabled.is_active).toBe(true);

    publicList = await productService.listProducts({}, { isAdmin: false });
    expect(publicList.items.map((p) => p.id)).toContain(id);
    const detail = await productService.getProductDetail(id, { isAdmin: false });
    expect(detail.id).toBe(id);
  });

  it('(f) deleted_at soft-delete is untouched by is_active: a deleted-but-active product is still hidden from everyone', async () => {
    const id = await seedProduct({ deleted_at: new Date() });

    const adminList = await productService.listProducts({}, { isAdmin: true });
    const publicList = await productService.listProducts({}, { isAdmin: false });
    expect(adminList.items.map((p) => p.id)).not.toContain(id);
    expect(publicList.items.map((p) => p.id)).not.toContain(id);

    await expect(productService.getProductDetail(id, { isAdmin: true })).rejects.toMatchObject({ statusCode: 404 });
  });

  it('setProductActive throws notFound for a nonexistent product id', async () => {
    await expect(productService.setProductActive(999999, false)).rejects.toMatchObject({ statusCode: 404 });
  });
});
