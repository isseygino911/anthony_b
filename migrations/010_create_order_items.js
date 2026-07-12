/**
 * order_items — architecture.md §8 / §7.1 (price snapshot lines + adjustments)
 */
exports.up = function up(knex) {
  return knex.schema.createTable('order_items', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('order_id').unsigned().notNullable();
    table.enu('item_type', ['line', 'adjustment']).notNullable();
    table.integer('product_id').unsigned().nullable();
    table.string('label', 255).notNullable();
    table.decimal('unit_price', 10, 2).nullable();
    table.integer('quantity').unsigned().nullable();
    table.decimal('amount', 10, 2).nullable();
    table.datetime('created_at').notNullable();

    table.index(['order_id']);
    table.index(['product_id']);

    table
      .foreign('order_id')
      .references('orders.id')
      .onDelete('CASCADE');
    table
      .foreign('product_id')
      .references('products.id')
      .onDelete('SET NULL');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('order_items');
};
