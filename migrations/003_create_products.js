/**
 * products — architecture.md §8
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('products', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('category_id').unsigned().notNullable();
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.decimal('price', 10, 2).notNullable();
    table.string('sku', 64).notNullable();
    table.json('tags').nullable();
    table.integer('stock_quantity').unsigned().notNullable().defaultTo(0);
    table.integer('low_stock_threshold').unsigned().nullable();
    table.boolean('is_featured').notNullable().defaultTo(false);
    table.boolean('is_bestseller').notNullable().defaultTo(false);
    table.boolean('is_clearance').notNullable().defaultTo(false);
    table.datetime('deleted_at').nullable();
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.unique(['sku']);
    table.index(['category_id']);
    table.index(['is_featured']);
    table.index(['is_bestseller']);
    table.index(['is_clearance']);
    table.index(['deleted_at']);

    table
      .foreign('category_id')
      .references('categories.id')
      .onDelete('RESTRICT');
  });

  // FULLTEXT index for search (GET /api/products?search=) — added via raw SQL
  // since Knex's schema builder doesn't expose a portable FULLTEXT helper.
  await knex.raw(
    'ALTER TABLE `products` ADD FULLTEXT INDEX `products_name_description_fulltext` (`name`, `description`)'
  );
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('products');
};
