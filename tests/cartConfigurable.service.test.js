// cart.service.addItem — configurable-product path (pricing.service.js +
// options-hash upsert, migrations/033). Unlike mergeAnonCartIntoUser (tested
// in cart.service.test.js via an explicit trx), addItem uses the
// module-level `db`, so this suite needs isolateDb — same technique as
// pricing.service.test.js / order.service.test.js.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring cart.service below
const cartService = require('../src/services/cart.service');

const TABLES = ['product_option_choices', 'product_option_groups', 'carts', 'product_images', 'products'];

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
    t.decimal('price', 10, 2);
    t.boolean('is_quote').defaultTo(false);
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

  await db.schema.createTable('product_option_groups', (t) => {
    t.increments('id');
    t.integer('product_id');
    t.string('key');
    t.string('label');
    t.string('type').defaultTo('single_select');
    t.integer('sort_order').defaultTo(0);
    t.datetime('created_at');
    t.datetime('updated_at');
  });

  await db.schema.createTable('product_option_choices', (t) => {
    t.increments('id');
    t.integer('option_group_id');
    t.string('key');
    t.string('label');
    t.decimal('price_delta', 10, 2).defaultTo(0);
    t.json('extra').nullable();
    t.integer('sort_order').defaultTo(0);
    t.datetime('created_at');
    t.datetime('updated_at');
  });
}

beforeEach(resetSchema);

afterAll(async () => {
  await db.destroy();
});

const LIGHTING_PRICING_CONFIG = {
  formulaType: 'linear_per_unit',
  params: { basePrice: 35, unitSizeInches: 12, pricePerExtraUnit: 25, wattsPerUnit: 4 },
};

async function seedConfigurableProduct() {
  const [id] = await db('products').insert({
    category_id: 1,
    name: 'Neon Strip',
    price: 0,
    pricing_config: JSON.stringify(LIGHTING_PRICING_CONFIG),
    created_at: new Date(),
    updated_at: new Date(),
  });

  const [controllerGroupId] = await db('product_option_groups').insert({
    product_id: id,
    key: 'controller',
    label: 'Controller',
    type: 'single_select',
    sort_order: 0,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await db('product_option_choices').insert([
    { option_group_id: controllerGroupId, key: 'motion_sensor', label: 'Motion sensor', price_delta: 250, sort_order: 0, created_at: new Date(), updated_at: new Date() },
    { option_group_id: controllerGroupId, key: 'none', label: 'No controller', price_delta: 0, sort_order: 1, created_at: new Date(), updated_at: new Date() },
  ]);

  return id;
}

async function seedFlatProduct() {
  const [id] = await db('products').insert({
    category_id: 1,
    name: 'Plain Widget',
    price: 19.99,
    pricing_config: null,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return id;
}

describe('cart.service.addItem — configurable products', () => {
  it('inserts a priced line using selections, snapshotting unit_price server-side', async () => {
    const productId = await seedConfigurableProduct();
    const cart = await cartService.addItem(
      { anonSessionId: 'sess-1' },
      productId,
      1,
      { sizeInches: 24, choiceKeysByGroupKey: { controller: 'motion_sensor' } }
    );

    expect(cart.items).toHaveLength(1);
    // 24" -> 2 units -> $60 base + $250 controller = $310
    expect(cart.items[0].price).toBeCloseTo(310);
    expect(cart.items[0].quantity).toBe(1);
  });

  it('upserts (increments quantity) when the identical configuration is re-added', async () => {
    const productId = await seedConfigurableProduct();
    const selections = { sizeInches: 12, choiceKeysByGroupKey: { controller: 'none' } };

    await cartService.addItem({ anonSessionId: 'sess-1' }, productId, 1, selections);
    const cart = await cartService.addItem({ anonSessionId: 'sess-1' }, productId, 2, selections);

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(3);
  });

  it('creates a separate line when the same product is added with a different configuration', async () => {
    const productId = await seedConfigurableProduct();

    await cartService.addItem(
      { anonSessionId: 'sess-1' },
      productId,
      1,
      { sizeInches: 12, choiceKeysByGroupKey: { controller: 'none' } }
    );
    const cart = await cartService.addItem(
      { anonSessionId: 'sess-1' },
      productId,
      1,
      { sizeInches: 24, choiceKeysByGroupKey: { controller: 'motion_sensor' } }
    );

    expect(cart.items).toHaveLength(2);
    const prices = cart.items.map((i) => i.price).sort((a, b) => a - b);
    expect(prices).toEqual([35, 310]);
  });

  it('rejects adding a configurable product without selections', async () => {
    const productId = await seedConfigurableProduct();
    await expect(cartService.addItem({ anonSessionId: 'sess-1' }, productId, 1, null)).rejects.toThrow(
      /requires selectedOptions/
    );
  });

  it('still upserts a plain (non-configurable) product by product_id only, unaffected by the options_hash change', async () => {
    const productId = await seedFlatProduct();

    await cartService.addItem({ anonSessionId: 'sess-1' }, productId, 1);
    const cart = await cartService.addItem({ anonSessionId: 'sess-1' }, productId, 2);

    expect(cart.items).toHaveLength(1);
    expect(cart.items[0].quantity).toBe(3);
    expect(cart.items[0].price).toBeCloseTo(19.99);
  });
});
