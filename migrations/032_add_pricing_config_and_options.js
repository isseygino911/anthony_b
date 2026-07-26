/**
 * Configurable-product pricing: products.pricing_config drives a base-price
 * formula (e.g. "$35 + $25 per additional 12", 12" minimum, 4W/12""), and
 * product_option_groups/product_option_choices hold admin-defined add-on
 * choices (controller, power supply, installation) each with a flat
 * price_delta. See product.service.js's pricing.service.js for the one place
 * these are combined into a total — never recomputed elsewhere (mirrors the
 * order-total single-source-of-truth rule, architecture.md §7.1).
 *
 * pricing_config shape: { formulaType: 'linear_per_unit', params: {
 *   basePrice, unitSizeInches, pricePerExtraUnit, wattsPerUnit } }.
 * NULL means the product is a plain flat-price product (unchanged behavior).
 *
 * product_option_choices.extra JSON currently only carries
 * { wattageCapacity } for power-supply-like choices (used to gate selection
 * against the size-derived wattage load) — NULL means unconstrained.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('products', (table) => {
    table.json('pricing_config').nullable();
  });

  await knex.schema.createTable('product_option_groups', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('product_id').unsigned().notNullable();
    table.string('key', 64).notNullable();
    table.string('label', 255).notNullable();
    table.enu('type', ['single_select', 'multi_select']).notNullable().defaultTo('single_select');
    table.smallint('sort_order').unsigned().notNullable().defaultTo(0);
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.unique(['product_id', 'key']);
    table.index(['product_id']);

    table.foreign('product_id').references('products.id').onDelete('CASCADE');
  });

  await knex.schema.createTable('product_option_choices', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('option_group_id').unsigned().notNullable();
    table.string('key', 64).notNullable();
    table.string('label', 255).notNullable();
    table.decimal('price_delta', 10, 2).notNullable().defaultTo(0);
    table.json('extra').nullable();
    table.smallint('sort_order').unsigned().notNullable().defaultTo(0);
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.unique(['option_group_id', 'key']);
    table.index(['option_group_id']);

    table.foreign('option_group_id').references('product_option_groups.id').onDelete('CASCADE');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('product_option_choices');
  await knex.schema.dropTableIfExists('product_option_groups');
  await knex.schema.alterTable('products', (table) => {
    table.dropColumn('pricing_config');
  });
};
