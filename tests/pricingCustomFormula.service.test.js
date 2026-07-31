// pricing.service.computePrice with an admin-authored ('custom') formula.
// Mirrors pricing.service.test.js's isolateDb + hand-rolled schema setup, since
// productOptions.service.js's models use the module-level `db`.
//
// The rule under test throughout: a custom formula produces the BASE price, and
// option deltas are still added on top exactly as they are for the registry
// formulas. Existing products must be unaffected by this feature.
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

const now = () => new Date();

// The expression an admin gets when converting the legacy linear_per_unit
// product: $35 covers the first 12", each further 12" adds $25, 4W per unit.
const CONVERTED = {
  formulaType: 'custom',
  params: { constants: { basePrice: 35, unitSize: 12, perExtra: 25, wattsPerUnit: 4 }, minSizeInches: 12 },
  formula: {
    price: 'basePrice + max(0, ceil(sizeInches / unitSize) - 1) * perExtra',
    watts: 'ceil(sizeInches / unitSize) * wattsPerUnit',
  },
};

async function seedProduct(pricingConfig, { withGroups = true } = {}) {
  const [id] = await db('products').insert({
    category_id: 1,
    name: 'Neon Strip',
    price: 0,
    pricing_config: JSON.stringify(pricingConfig),
    created_at: now(),
    updated_at: now(),
  });

  if (withGroups) {
    const [controllerGroupId] = await db('product_option_groups').insert({
      product_id: id, key: 'controller', label: 'Controller', type: 'single_select', sort_order: 0, created_at: now(), updated_at: now(),
    });
    await db('product_option_choices').insert([
      { option_group_id: controllerGroupId, key: 'motion_sensor', label: 'Motion sensor', price_delta: 250, sort_order: 0, created_at: now(), updated_at: now() },
      { option_group_id: controllerGroupId, key: 'none', label: 'No controller', price_delta: 0, sort_order: 1, created_at: now(), updated_at: now() },
    ]);

    const [psuGroupId] = await db('product_option_groups').insert({
      product_id: id, key: 'power_supply', label: 'DC Power Supply', type: 'single_select', sort_order: 1, created_at: now(), updated_at: now(),
    });
    await db('product_option_choices').insert([
      { option_group_id: psuGroupId, key: '100w', label: '100-watt', price_delta: 40, extra: JSON.stringify({ wattageCapacity: 100 }), sort_order: 0, created_at: now(), updated_at: now() },
      { option_group_id: psuGroupId, key: '10w', label: '10-watt', price_delta: 5, extra: JSON.stringify({ wattageCapacity: 10 }), sort_order: 1, created_at: now(), updated_at: now() },
    ]);

    const [installGroupId] = await db('product_option_groups').insert({
      product_id: id, key: 'installation', label: 'Installation', type: 'single_select', sort_order: 2, created_at: now(), updated_at: now(),
    });
    await db('product_option_choices').insert([
      { option_group_id: installGroupId, key: 'yes', label: 'Installation', price_delta: 2000, extra: JSON.stringify({ isFlatFee: true }), sort_order: 0, created_at: now(), updated_at: now() },
      { option_group_id: installGroupId, key: 'no', label: 'No installation', price_delta: 0, extra: JSON.stringify({ isFlatFee: true }), sort_order: 1, created_at: now(), updated_at: now() },
    ]);
  }

  return db('products').where({ id }).first();
}

describe('custom formula — base pricing', () => {
  it('prices from built-ins and constants alone', async () => {
    const product = await seedProduct(CONVERTED, { withGroups: false });
    const priced = await pricingService.computePrice(product, { sizeInches: 24, choiceKeysByGroupKey: {} });
    // 24" -> 2 units -> 35 + 1*25 = 60
    expect(priced.unitPrice).toBeCloseTo(60);
    expect(priced.totalWatts).toBe(8);
  });

  // The property that makes the admin "Convert to custom formula" button safe.
  it.each([
    [12, 35, 4],
    [13, 60, 8],
    [24, 60, 8],
    [100, 235, 36],
  ])('matches linear_per_unit at %i" -> $%i / %iW', async (sizeInches, price, watts) => {
    const product = await seedProduct(CONVERTED, { withGroups: false });
    const priced = await pricingService.computePrice(product, { sizeInches, choiceKeysByGroupKey: {} });
    expect(priced.unitPrice).toBeCloseTo(price);
    expect(priced.totalWatts).toBe(watts);
  });
});

describe('custom formula — option variables', () => {
  it('reads a group key as the selected choice priceDelta', async () => {
    const config = { ...CONVERTED, formula: { price: 'controller * 2' } };
    const product = await seedProduct(config);
    const priced = await pricingService.computePrice(product, {
      sizeInches: 12,
      choiceKeysByGroupKey: { controller: 'motion_sensor' },
    });
    // formula 250*2 = 500 base, then the same 250 delta is added on top
    expect(priced.unitPrice).toBeCloseTo(750);
  });

  it('reads a numeric attribute from the selected choice extra', async () => {
    const config = { ...CONVERTED, formula: { price: 'power_supply_wattageCapacity' } };
    const product = await seedProduct(config);
    const priced = await pricingService.computePrice(product, {
      sizeInches: 12,
      choiceKeysByGroupKey: { power_supply: '100w' },
    });
    // 100 (capacity as base) + 40 (its own delta, added on top)
    expect(priced.unitPrice).toBeCloseTo(140);
  });

  it('resolves an unanswered group to 0 without erroring', async () => {
    const config = { ...CONVERTED, formula: { price: '100 + controller + power_supply_wattageCapacity' } };
    const product = await seedProduct(config);
    const priced = await pricingService.computePrice(product, { sizeInches: 12, choiceKeysByGroupKey: {} });
    expect(priced.unitPrice).toBeCloseTo(100);
  });

  it('exposes optionsTotal as the summed non-flat deltas', async () => {
    const config = { ...CONVERTED, formula: { price: 'optionsTotal * 10' } };
    const product = await seedProduct(config);
    const priced = await pricingService.computePrice(product, {
      sizeInches: 12,
      choiceKeysByGroupKey: { controller: 'motion_sensor', power_supply: '100w' },
    });
    // deltas 250+40 = 290 -> formula 2900 base, + 290 added on top
    expect(priced.unitPrice).toBeCloseTo(3190);
  });
});

describe('custom formula — composition with deltas and flat fees', () => {
  it('adds non-flat deltas on top and keeps a flat fee separate', async () => {
    const product = await seedProduct(CONVERTED);
    const priced = await pricingService.computePrice(product, {
      sizeInches: 24,
      choiceKeysByGroupKey: { controller: 'motion_sensor', power_supply: '100w', installation: 'yes' },
    });
    // base 60 + 250 + 40 = 350; installation is a flat fee, never in unitPrice
    expect(priced.unitPrice).toBeCloseTo(350);
    expect(priced.flatFeeDelta).toBeCloseTo(2000);
    expect(priced.selectedOptionsSnapshot.flatFeeDelta).toBeCloseTo(2000);
  });

  it('clamps a negative formula result to 0 rather than crediting the customer', async () => {
    const config = { ...CONVERTED, formula: { price: '0 - 500' } };
    const product = await seedProduct(config, { withGroups: false });
    const priced = await pricingService.computePrice(product, { sizeInches: 12, choiceKeysByGroupKey: {} });
    expect(priced.unitPrice).toBe(0);
  });
});

describe('custom formula — wattage gating and size guard', () => {
  it('still rejects a power supply below the formula-computed load', async () => {
    const product = await seedProduct(CONVERTED);
    // 100" -> 9 units -> 36W, which the 10W supply cannot carry
    await expect(
      pricingService.computePrice(product, { sizeInches: 100, choiceKeysByGroupKey: { power_supply: '10w' } })
    ).rejects.toThrow(/cannot support the calculated load of 36W/);
  });

  it('accepts a supply that exactly meets the load', async () => {
    const product = await seedProduct(CONVERTED);
    // 24" -> 2 units -> 8W, under the 10W supply
    const priced = await pricingService.computePrice(product, {
      sizeInches: 24,
      choiceKeysByGroupKey: { power_supply: '10w' },
    });
    expect(priced.totalWatts).toBe(8);
  });

  it('treats totalWatts as 0 when no watts formula is given', async () => {
    const config = { ...CONVERTED, formula: { price: '100' } };
    const product = await seedProduct(config);
    const priced = await pricingService.computePrice(product, {
      sizeInches: 12,
      choiceKeysByGroupKey: { power_supply: '10w' },
    });
    expect(priced.totalWatts).toBe(0);
  });

  it('rejects a size below minSizeInches so the client cannot bypass the storefront min', async () => {
    const product = await seedProduct(CONVERTED, { withGroups: false });
    await expect(
      pricingService.computePrice(product, { sizeInches: 6, choiceKeysByGroupKey: {} })
    ).rejects.toThrow(/at least 12 inches/);
  });

  it('surfaces a division-by-zero in the formula as a bad request, never Infinity', async () => {
    const config = { ...CONVERTED, formula: { price: '100 / controller' } };
    const product = await seedProduct(config);
    await expect(
      pricingService.computePrice(product, { sizeInches: 12, choiceKeysByGroupKey: { controller: 'none' } })
    ).rejects.toThrow(/division by zero/);
  });
});
