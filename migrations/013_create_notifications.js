/**
 * notifications — architecture.md §8 / §7.2 (low-stock notifications)
 */
exports.up = function up(knex) {
  return knex.schema.createTable('notifications', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.enu('type', ['low_stock']).notNullable();
    table.integer('product_id').unsigned().nullable();
    table.string('message', 500).notNullable();
    table.boolean('is_read').notNullable().defaultTo(false);
    table.datetime('created_at').notNullable();

    table.index(['is_read']);
    table.index(['created_at']);

    table
      .foreign('product_id')
      .references('products.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('notifications');
};
