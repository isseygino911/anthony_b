// pricing.service.computePrice — combines pricingFormulas' base price with
// option-group deltas and enforces wattage gating (power-supply capacity
// must cover the size-derived load). Uses the same isolateDb technique as
// product.service.test.js / order.service.test.js since productOptions
// .service.js's models use the module-level `db`, not an injectable trx.
// Schema is self-contained (not testDb.js's applySchema) since this suite
// needs product.created_at/updated_at, which that shared minimal schema
// doesn't carry — mirrors product.service.test.js's own hand-rolled schema.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring pricing.service below
const pricingService = require('../src/services/pricing.service');

const TABLES = ['product_option_choices', 'product_option_groups', 'products'];

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
    t.json('pricing_config').nullable();
    t.datetime('created_at');
    t.datetime('updated_at');
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

async function seedLightingProduct() {
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
    label: 'Option 1: Controller',
    type: 'single_select',
    sort_order: 0,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await db('product_option_choices').insert([
    { option_group_id: controllerGroupId, key: 'motion_sensor', label: 'Motion sensor controller', price_delta: 250, sort_order: 0, created_at: new Date(), updated_at: new Date() },
    { option_group_id: controllerGroupId, key: 'none', label: 'No controller', price_delta: 0, sort_order: 1, created_at: new Date(), updated_at: new Date() },
  ]);

  const [psuGroupId] = await db('product_option_groups').insert({
    product_id: id,
    key: 'power_supply',
    label: 'Option 2: DC Power Supply',
    type: 'single_select',
    sort_order: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await db('product_option_choices').insert([
    { option_group_id: psuGroupId, key: '100w', label: '100-watt', price_delta: 40, extra: JSON.stringify({ wattageCapacity: 100 }), sort_order: 0, created_at: new Date(), updated_at: new Date() },
    { option_group_id: psuGroupId, key: '150w', label: '150-watt', price_delta: 65, extra: JSON.stringify({ wattageCapacity: 150 }), sort_order: 1, created_at: new Date(), updated_at: new Date() },
    { option_group_id: psuGroupId, key: '600w', label: '600-watt', price_delta: 240, extra: JSON.stringify({ wattageCapacity: 600 }), sort_order: 2, created_at: new Date(), updated_at: new Date() },
  ]);

  const [installGroupId] = await db('product_option_groups').insert({
    product_id: id,
    key: 'installation',
    label: 'Option 3: Installation',
    type: 'single_select',
    sort_order: 2,
    created_at: new Date(),
    updated_at: new Date(),
  });
  await db('product_option_choices').insert([
    { option_group_id: installGroupId, key: 'yes', label: 'Installation', price_delta: 2000, extra: JSON.stringify({ isFlatFee: true }), sort_order: 0, created_at: new Date(), updated_at: new Date() },
    { option_group_id: installGroupId, key: 'no', label: 'No installation', price_delta: 0, extra: JSON.stringify({ isFlatFee: true }), sort_order: 1, created_at: new Date(), updated_at: new Date() },
  ]);

  return db('products').where({ id }).first();
}

describe('pricing.service.computePrice', () => {
  it('sums base price + option deltas for a 24" strip with motion sensor + 150w PSU', async () => {
    const product = await seedLightingProduct();
    const priced = await pricingService.computePrice(product, {
      sizeInches: 24,
      choiceKeysByGroupKey: { controller: 'motion_sensor', power_supply: '150w', installation: 'no' },
    });

    // base: 24" -> 2 units -> $35 + $25 = $60; + $250 controller + $65 PSU = $375
    expect(priced.unitPrice).toBeCloseTo(375);
    expect(priced.totalWatts).toBe(8);
    expect(priced.selectedOptionsSnapshot.flatFeeDelta).toBe(0);
  });

  it('keeps a flat fee (installation) out of unitPrice, surfaced separately', async () => {
    const product = await seedLightingProduct();
    const priced = await pricingService.computePrice(product, {
      sizeInches: 12,
      choiceKeysByGroupKey: { controller: 'none', power_supply: '100w', installation: 'yes' },
    });

    // base $35 + $0 controller + $40 PSU = $75 unit price; $2000 install is separate
    expect(priced.unitPrice).toBeCloseTo(75);
    expect(priced.selectedOptionsSnapshot.flatFeeDelta).toBe(2000);
  });

  it('rejects a power supply whose wattage capacity is below the calculated load', async () => {
    const product = await seedLightingProduct();
    // 100" -> 9 units -> 36W load; 100w capacity PSU still covers it (>=), but
    // pick a size large enough that even the 150w option can't cover it.
    await expect(
      pricingService.computePrice(product, {
        sizeInches: 468, // ceil(468/12)=39 units -> 156W load
        choiceKeysByGroupKey: { controller: 'none', power_supply: '150w', installation: 'no' },
      })
    ).rejects.toThrow(/cannot support the calculated load/);
  });

  it('accepts a power supply whose capacity exactly meets the calculated load', async () => {
    const product = await seedLightingProduct();
    const priced = await pricingService.computePrice(product, {
      sizeInches: 300, // ceil(300/12)=25 units -> 100W load
      choiceKeysByGroupKey: { controller: 'none', power_supply: '100w', installation: 'no' },
    });
    expect(priced.totalWatts).toBe(100);
    expect(priced.unitPrice).toBeGreaterThan(0);
  });

  it('rejects an unknown choice key for a known group', async () => {
    const product = await seedLightingProduct();
    await expect(
      pricingService.computePrice(product, {
        sizeInches: 12,
        choiceKeysByGroupKey: { controller: 'does_not_exist' },
      })
    ).rejects.toThrow(/Invalid choice/);
  });

  it('rejects computing a price for a non-configurable product', async () => {
    const [id] = await db('products').insert({
      category_id: 1,
      name: 'Plain Widget',
      price: 10,
      pricing_config: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const product = await db('products').where({ id }).first();
    await expect(pricingService.computePrice(product, { sizeInches: 12, choiceKeysByGroupKey: {} })).rejects.toThrow(
      /not configurable/
    );
  });
});
