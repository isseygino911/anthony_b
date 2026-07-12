/**
 * product_images — architecture.md §8
 */
exports.up = function up(knex) {
  return knex.schema.createTable('product_images', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('product_id').unsigned().notNullable();
    table.string('url', 500).notNullable();
    table.boolean('is_primary').notNullable().defaultTo(false);
    table.specificType('sort_order', 'SMALLINT UNSIGNED').notNullable().defaultTo(0);
    table.datetime('created_at').notNullable();

    table.index(['product_id']);

    table
      .foreign('product_id')
      .references('products.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('product_images');
};
