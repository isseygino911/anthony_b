// customNeonDesign.service.createProductFromDesign — the admin "Create
// product" action on the Custom Neon Designs page.
//
// This exists because allowing anonymous generation broke the previous
// workflow: an admin whose auth cookie didn't reach the generate request
// silently produced a design with user_id NULL, which belongsToIdentity can
// never match for a logged-in caller, so confirmDesign (the only other way to
// mint a product from a design) rejected it as "Design not found". These
// tests pin the three ways this function deliberately differs from
// confirmDesign: no ownership check, its own SKU namespace, and a
// shop-visible product that does not claim design.product_id.
//
// upload.service is stubbed because the real getObjectBuffer/putBuffer call
// assertConfigured() and would throw without S3 credentials; everything else
// runs against the in-memory DB via isolateDb() (see that helper for why
// mocking config/db isn't viable here).
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const path = require('path');
const Module = require('module');
const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the service below

// Same require-cache technique isolateDb uses — vi.mock does not intercept
// the nested CommonJS require() that the service performs at load time.
const UPLOAD_PATH = require.resolve(path.join(__dirname, '..', 'src', 'services', 'upload.service.js'));
const putBuffer = vi.fn(async () => 'https://bucket.s3.us-east-1.amazonaws.com/products/custom-neon/copy.png');
const getObjectBuffer = vi.fn(async () => ({ buffer: Buffer.from('img'), mimetype: 'image/png' }));
const uploadModule = new Module(UPLOAD_PATH, module);
uploadModule.filename = UPLOAD_PATH;
uploadModule.loaded = true;
uploadModule.exports = { getObjectBuffer, putBuffer };
require.cache[UPLOAD_PATH] = uploadModule;

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
    t.json('pricing_config').nullable();
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
    t.string('options_hash', 64).nullable();
    t.json('selected_options').nullable();
    t.decimal('size_inches', 8, 2).nullable();
    t.decimal('unit_price', 10, 2).nullable();
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

let categoryId;

beforeEach(async () => {
  await resetSchema();
  vi.clearAllMocks();
  [categoryId] = await db('categories').insert({
    name: 'Custom Neon Signs',
    slug: 'custom-neon-signs',
    is_internal: true,
    created_at: new Date(),
  });
});

afterAll(async () => {
  await db.destroy();
});

const DESIGN_IMAGE = 'https://bucket.s3.us-east-1.amazonaws.com/custom-neon/generated/abc.png';

async function seedDesign(overrides = {}) {
  const now = new Date();
  const [id] = await db('custom_neon_designs').insert({
    user_id: null,
    session_id: 'anon-session-1',
    design_type: 'draw',
    input_payload: JSON.stringify({ strokes: [] }),
    size: 'medium',
    neon_color: 'pink',
    status: 'ready',
    attempts: 0,
    generated_image_url: DESIGN_IMAGE,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
  return id;
}

function publishInput(overrides = {}) {
  return { name: 'Neon Flamingo', description: 'A sign', price: 129.99, categoryId, ...overrides };
}

describe('customNeonDesign.service.createProductFromDesign', () => {
  // The case the feature exists for. A logged-in non-admin cannot reach an
  // anonymous design at all (belongsToIdentity checks user_id first, and NULL
  // never matches), and an admin can only reach it through admin-only
  // surfaces — listMine/findActive, which drive the storefront designer, key
  // strictly on the identity with no admin bypass, so the design never
  // appears there to be confirmed. Publishing keys on the design id alone.
  it('publishes a design that has no user_id and is unreachable from the storefront', async () => {
    const id = await seedDesign({ user_id: null, session_id: 'anon-session-1' });
    const loggedIn = { user: { id: 3, role: 'customer' }, anonSessionId: null };

    await expect(customNeonDesignService.confirmDesign(id, loggedIn)).rejects.toThrow(/Design not found/);
    const mine = await customNeonDesignService.listMine(loggedIn, { page: 1, pageSize: 20 });
    expect(mine.items).toHaveLength(0);

    const product = await customNeonDesignService.createProductFromDesign(id, publishInput());

    expect(product).toMatchObject({ name: 'Neon Flamingo', sku: `NEON-PUB-${id}`, is_active: 1 });
    expect(Number(product.price)).toBe(129.99);
  });

  it('copies the image to a new key rather than reusing the design URL', async () => {
    const id = await seedDesign();

    const product = await customNeonDesignService.createProductFromDesign(id, publishInput());

    expect(getObjectBuffer).toHaveBeenCalledWith(DESIGN_IMAGE);
    expect(putBuffer).toHaveBeenCalledWith(Buffer.from('img'), 'image/png', 'products/custom-neon');

    const image = await db('product_images').where({ product_id: product.id }).first();
    expect(image.url).toBe('https://bucket.s3.us-east-1.amazonaws.com/products/custom-neon/copy.png');
    expect(image.is_primary).toBe(1);
    // A shared URL would 404 as soon as neon-design-cleanup.js purges the
    // design, since publishing deliberately leaves product_id null.
    expect(image.url).not.toBe(DESIGN_IMAGE);
  });

  // product_id means "confirmed into a customer order". Setting it here would
  // both misreport the design as purchased and hide it from the purge job.
  it('leaves design.product_id null so the customer confirm flow still works', async () => {
    const id = await seedDesign();

    await customNeonDesignService.createProductFromDesign(id, publishInput());

    const design = await db('custom_neon_designs').where({ id }).first();
    expect(design.product_id).toBeNull();

    // The published SKU must not collide with the one confirmDesign mints,
    // which is what its idempotency depends on.
    const { design: confirmed } = await customNeonDesignService.confirmDesign(id, {
      user: null,
      anonSessionId: 'anon-session-1',
    });
    expect(confirmed.productId).toBeTruthy();

    const skus = (await db('products').select('sku')).map((r) => r.sku).sort();
    expect(skus).toEqual([`NEON-${id}`, `NEON-PUB-${id}`]);
  });

  it('can publish as a hidden product when isActive is false', async () => {
    const id = await seedDesign();

    const product = await customNeonDesignService.createProductFromDesign(
      id,
      publishInput({ isActive: false })
    );

    expect(product.is_active).toBe(0);
  });

  // Publishing leaves product_id null, so the designs list keeps offering
  // "Create product" for an already-published design — double-clicking it is
  // easy. Caught in browser testing: without the guard this surfaced a raw
  // ER_DUP_ENTRY as a 500, after already uploading a duplicate S3 object.
  it('rejects publishing the same design twice with a clear conflict', async () => {
    const id = await seedDesign();
    const first = await customNeonDesignService.createProductFromDesign(id, publishInput());
    vi.clearAllMocks();

    await expect(customNeonDesignService.createProductFromDesign(id, publishInput())).rejects.toMatchObject({
      statusCode: 409,
      message: `This design was already published as product #${first.id}`,
    });

    // Bails out before spending an S3 round-trip on the duplicate.
    expect(getObjectBuffer).not.toHaveBeenCalled();
    expect(putBuffer).not.toHaveBeenCalled();
    expect(await db('products').count({ n: '*' }).first()).toMatchObject({ n: 1 });
  });

  it('rejects a design whose preview is not ready', async () => {
    const id = await seedDesign({ status: 'pending', generated_image_url: null });

    await expect(customNeonDesignService.createProductFromDesign(id, publishInput())).rejects.toThrow(
      /ready preview/
    );
  });

  // Unreachable while the cleanup job is unscheduled, but the guard is what
  // stops a product being created with no image if it is ever switched on.
  it('rejects a design whose image has been purged', async () => {
    const id = await seedDesign({ generated_image_url: null, images_purged_at: new Date() });

    await expect(customNeonDesignService.createProductFromDesign(id, publishInput())).rejects.toThrow(
      /no longer has a preview image/
    );
  });

  it('rejects an unknown design and an unknown category', async () => {
    const id = await seedDesign();

    await expect(customNeonDesignService.createProductFromDesign(9999, publishInput())).rejects.toThrow(
      /Design not found/
    );
    await expect(
      customNeonDesignService.createProductFromDesign(id, publishInput({ categoryId: 9999 }))
    ).rejects.toThrow(/Category not found/);
  });
});
