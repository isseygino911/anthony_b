/**
 * product_group_items — architecture.md §8
 * Composite PK (group_id, product_id) join table.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('product_group_items', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.integer('group_id').unsigned().notNullable();
    table.integer('product_id').unsigned().notNullable();

    table.primary(['group_id', 'product_id']);
    table.index(['product_id']);

    table
      .foreign('group_id')
      .references('product_groups.id')
      .onDelete('CASCADE');
    table
      .foreign('product_id')
      .references('products.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('product_group_items');
};
