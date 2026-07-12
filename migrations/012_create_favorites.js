/**
 * favorites — architecture.md §8
 * Composite PK (user_id, product_id) join table.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('favorites', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.integer('user_id').unsigned().notNullable();
    table.integer('product_id').unsigned().notNullable();
    table.datetime('created_at').notNullable();

    table.primary(['user_id', 'product_id']);
    table.index(['product_id']);

    table
      .foreign('user_id')
      .references('users.id')
      .onDelete('CASCADE');
    table
      .foreign('product_id')
      .references('products.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('favorites');
};
