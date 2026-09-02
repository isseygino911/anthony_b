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
    t.boolean('is_quote').defaultTo(false);
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
    t.decimal('custom_width_in', 6, 2).nullable();
    t.decimal('custom_height_in', 6, 2).nullable();
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
    expect(design.price).toBe(399.99);
    expect(design.productId).toBeTruthy();

    const product = await db('products').where({ id: design.productId }).first();
    expect(Number(product.price)).toBe(399.99);
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

  it('prices small/large tiers per the size/price map, using the size stored on the design (set at generation time)', async () => {
    const smallId = await seedDesign({ size: 'small', neon_color: 'blue' });
    const { design: small } = await customNeonDesignService.confirmDesign(smallId, anonIdentity);
    expect(small.price).toBe(249.99);

    const largeId = await seedDesign({ session_id: 'anon-session-1', size: 'large', neon_color: 'white' });
    const { design: large } = await customNeonDesignService.confirmDesign(largeId, anonIdentity);
    expect(large.price).toBe(524.99);
  });

  // "Order again" (My Designs page) calls this same endpoint on a design
  // that already has product_id set — must not re-run the product-creation
  // transaction (that would collide on the unique sku NEON-${id}), just
  // re-add the existing product to the cart.
  it('re-confirming an already-confirmed design reuses the existing product instead of minting a duplicate', async () => {
    const id = await seedDesign();

    const first = await customNeonDesignService.confirmDesign(id, anonIdentity);
    const second = await customNeonDesignService.confirmDesign(id, anonIdentity);

    expect(second.design.productId).toBe(first.design.productId);

    const products = await db('products').where({ sku: `NEON-${id}` });
    expect(products).toHaveLength(1);

    expect(second.cart.items).toHaveLength(1);
    expect(second.cart.items[0]).toMatchObject({ productId: first.design.productId, quantity: 2 });
  });
});

describe('customNeonDesign.service.listMine', () => {
  const userIdentity = { user: { id: 42, role: 'customer' }, anonSessionId: null };

  it('returns only the calling user\'s designs, newest first', async () => {
    await seedDesign({ user_id: 42, session_id: null, created_at: new Date('2026-01-01') });
    await seedDesign({ user_id: 42, session_id: null, created_at: new Date('2026-01-02') });
    await seedDesign({ user_id: 99, session_id: null, created_at: new Date('2026-01-03') });

    const result = await customNeonDesignService.listMine(userIdentity, { page: 1, pageSize: 20 });

    expect(result.total).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items.every((item) => item)).toBe(true);
    expect(new Date(result.items[0].createdAt).getTime()).toBeGreaterThan(new Date(result.items[1].createdAt).getTime());
  });

  it('returns an empty list for a user with no designs', async () => {
    const result = await customNeonDesignService.listMine(userIdentity, { page: 1, pageSize: 20 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
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

// The custom colour picker stores customer-picked colours inline in the same
// neon_color column as "custom:#rrggbb". The riskiest path is confirmDesign():
// it re-validates the *stored* value before minting the product, so a value
// that createDesign accepts but confirmDesign rejects would let a customer
// generate a preview they can never buy.
describe('customNeonDesign.service — custom colours', () => {
  it('confirms a design stored with a custom colour and mints its product', async () => {
    const id = await seedDesign({ neon_color: 'custom:#ff2d95' });

    const { design, cart } = await customNeonDesignService.confirmDesign(id, anonIdentity);

    expect(design.neonColor).toBe('custom:#ff2d95');
    expect(design.productId).toBeTruthy();
    expect(cart.items).toHaveLength(1);
  });

  it('keeps the raw token out of the customer-visible product description', async () => {
    const id = await seedDesign({ neon_color: 'custom:#ff2d95' });
    const { design } = await customNeonDesignService.confirmDesign(id, anonIdentity);

    const product = await db('products').where({ id: design.productId }).first();
    expect(product.description).toBe('Custom AI-generated neon sign design (24"x24", custom #FF2D95).');
    expect(product.description).not.toContain('custom:#');
  });

  it('still prices by size only — colour never changes the price', async () => {
    const custom = await seedDesign({ size: 'small', neon_color: 'custom:#00ffcc' });
    const preset = await seedDesign({ size: 'small', neon_color: 'blue', session_id: 'anon-session-2' });

    const a = await customNeonDesignService.confirmDesign(custom, anonIdentity);
    const b = await customNeonDesignService.confirmDesign(preset, { user: null, anonSessionId: 'anon-session-2' });

    expect(a.design.price).toBe(249.99);
    expect(b.design.price).toBe(a.design.price);
  });

  it.each([
    ['uppercase hex', 'custom:#FF2D95'],
    ['3-digit shorthand', 'custom:#fff'],
    ['non-hex characters', 'custom:#gggggg'],
    ['missing hex', 'custom:'],
    ['a colour name', 'custom:red'],
    ['trailing junk', 'custom:#ff2d95; DROP TABLE products'],
  ])('rejects %s at confirm time', async (_label, neonColor) => {
    const id = await seedDesign({ neon_color: neonColor });
    await expect(customNeonDesignService.confirmDesign(id, anonIdentity)).rejects.toMatchObject({
      statusCode: 400,
    });
  });

  it('normalises an uppercase custom colour to lowercase on regenerate', async () => {
    // One colour must have exactly one stored form: the storefront decides
    // whether the preview is stale with a plain === on this string.
    const id = await seedDesign({ status: 'failed' });
    const design = await customNeonDesignService.regenerate(id, anonIdentity, {
      size: 'large',
      neonColor: 'custom:#FF2D95',
    });
    expect(design.neonColor).toBe('custom:#ff2d95');
  });

  it('rejects an invalid custom colour on regenerate', async () => {
    const id = await seedDesign({ status: 'failed' });
    await expect(
      customNeonDesignService.regenerate(id, anonIdentity, { size: 'large', neonColor: 'custom:#zzzzzz' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('accepts every preset and the custom form, and nothing else', () => {
    const { isValidNeonColor } = customNeonDesignService;
    for (const preset of ['amber', 'pink', 'blue', 'white', 'red', 'green', 'purple', 'orange', 'ice-blue', 'warm-white']) {
      expect(isValidNeonColor(preset)).toBe(true);
    }
    expect(isValidNeonColor('custom:#ff2d95')).toBe(true);
    expect(isValidNeonColor(null)).toBe(false);
    expect(isValidNeonColor(undefined)).toBe(false);
    expect(isValidNeonColor('')).toBe(false);
    expect(isValidNeonColor('chartreuse')).toBe(false);
  });

  it('encodes a custom colour well inside the varchar(32) column', () => {
    expect('custom:#ff2d95'.length).toBe(14);
  });
});

// The fourth size option: the customer types their own dimensions and the
// design is quoted by hand rather than priced from SIZE_PRICES.
describe('customNeonDesign.service — custom size', () => {
  it('confirms a custom-size design into an unpriced product rather than a free one', async () => {
    const id = await seedDesign({ size: 'custom', custom_width_in: 48, custom_height_in: 18 });

    const { design } = await customNeonDesignService.confirmDesign(id, anonIdentity);

    // NULL price on the design says "not quoted yet"; the product carries a
    // 0.00 placeholder only because products.price is NOT NULL, with is_quote
    // as the flag that stops it reading as free.
    expect(design.price).toBeNull();
    expect(design.isQuote).toBe(true);
    const product = await db('products').where({ id: design.productId }).first();
    expect(Number(product.price)).toBe(0);
    expect(Boolean(product.is_quote)).toBe(true);
  });

  it('describes the typed dimensions in the product description', async () => {
    const id = await seedDesign({ size: 'custom', custom_width_in: 48, custom_height_in: 18 });

    const { design } = await customNeonDesignService.confirmDesign(id, anonIdentity);

    const product = await db('products').where({ id: design.productId }).first();
    expect(product.description).toContain('48"x18"');
  });

  it('exposes one derived dimensions label for both preset and custom sizes', async () => {
    const preset = await customNeonDesignService.getDesign(await seedDesign({ size: 'large' }), anonIdentity);
    const custom = await customNeonDesignService.getDesign(
      await seedDesign({ size: 'custom', custom_width_in: 30.5, custom_height_in: 12 }),
      anonIdentity
    );

    expect(preset.dimensions).toBe('36"x36"');
    expect(preset.isQuote).toBe(false);
    // Trailing zeros from DECIMAL(6,2) are trimmed: 30.50 reads as 30.5.
    expect(custom.dimensions).toBe('30.5"x12"');
    expect(custom.isQuote).toBe(true);
  });

  it('rejects a custom size with missing or out-of-range dimensions', async () => {
    const id = await seedDesign({ size: 'medium' });

    await expect(
      customNeonDesignService.regenerate(id, anonIdentity, { size: 'custom', neonColor: 'pink' })
    ).rejects.toThrow('Width and height are required');

    await expect(
      customNeonDesignService.regenerate(id, anonIdentity, {
        size: 'custom',
        neonColor: 'pink',
        customWidthIn: 1,
        customHeightIn: 20,
      })
    ).rejects.toThrow('Width must be between');

    await expect(
      customNeonDesignService.regenerate(id, anonIdentity, {
        size: 'custom',
        neonColor: 'pink',
        customWidthIn: 20,
        customHeightIn: 500,
      })
    ).rejects.toThrow('Height must be between');
  });

  it('rejects dimensions on a preset size, which would contradict its fixed label', async () => {
    const id = await seedDesign({ size: 'medium' });

    await expect(
      customNeonDesignService.regenerate(id, anonIdentity, {
        size: 'large',
        neonColor: 'pink',
        customWidthIn: 50,
        customHeightIn: 50,
      })
    ).rejects.toThrow('only valid with the custom size');
  });

  it('clears stored dimensions when switching from a custom size back to a preset', async () => {
    const id = await seedDesign({ size: 'custom', custom_width_in: 40, custom_height_in: 20 });

    await customNeonDesignService.regenerate(id, anonIdentity, { size: 'large', neonColor: 'pink' });

    const row = await db('custom_neon_designs').where({ id }).first();
    expect(row.size).toBe('large');
    // Left behind, these would fail validation on every later confirm.
    expect(row.custom_width_in).toBeNull();
    expect(row.custom_height_in).toBeNull();
  });
});

// The size, dimensions and colour are frozen onto the order line itself, not
// left to be recovered from products.description (prose) or the design row —
// order_items.product_id is ON DELETE SET NULL, so a deleted product would
// otherwise strip an order of everything but "Custom Neon Design #7".
describe('customNeonDesign.service — order line snapshot', () => {
  function choicesOf(row) {
    return Object.fromEntries(
      customNeonDesignService.buildNeonSnapshot(row).choices.map((c) => [c.groupKey, c.choiceLabel])
    );
  }

  it('captures size, dimensions and colour for a preset design', () => {
    expect(choicesOf({ size: 'large', neon_color: 'ice-blue' })).toEqual({
      neon_size: 'Large',
      neon_dimensions: '36"x36"',
      // Preset slugs are title-cased for display.
      neon_color: 'Ice Blue',
    });
  });

  it('uses the hex code itself as the label for a customer-picked colour', () => {
    const choices = choicesOf({ size: 'medium', neon_color: 'custom:#ff2d95' });
    // The hex is what identifies the colour to whoever fabricates the sign,
    // so it is the label — not the word "custom".
    expect(choices.neon_color).toBe('#FF2D95');
  });

  it('records the typed dimensions for a custom size', () => {
    expect(choicesOf({ size: 'custom', neon_color: 'pink', custom_width_in: 48, custom_height_in: 18 })).toEqual({
      neon_size: 'Custom',
      neon_dimensions: '48"x18"',
      neon_color: 'Pink',
    });
  });

  it('keeps the raw stored token as the machine-readable key', () => {
    const snapshot = customNeonDesignService.buildNeonSnapshot({
      size: 'custom',
      neon_color: 'custom:#ff2d95',
      custom_width_in: 40,
      custom_height_in: 40,
    });
    const colour = snapshot.choices.find((c) => c.groupKey === 'neon_color');
    expect(colour.choiceKey).toBe('custom:#ff2d95');
  });

  it('prices nothing — a neon design is priced by tier or by hand, never by option deltas', () => {
    const snapshot = customNeonDesignService.buildNeonSnapshot({ size: 'large', neon_color: 'pink' });
    // A non-zero priceDelta here would be split out as a separate flat-fee
    // line at checkout and charged twice.
    expect(snapshot.choices.every((c) => c.priceDelta === 0 && !c.isFlatFee)).toBe(true);
    expect(snapshot.flatFeeDelta).toBe(0);
  });

  it('attaches the snapshot to the cart line on confirm', async () => {
    const id = await seedDesign({ size: 'large', neon_color: 'ice-blue' });

    const { cart } = await customNeonDesignService.confirmDesign(id, anonIdentity);

    const line = cart.items.find((item) => item.name.includes(`#${id}`));
    expect(line.selectedOptions.choices.map((c) => c.choiceLabel)).toEqual([
      'Large',
      '36"x36"',
      'Ice Blue',
    ]);
  });
});
