/**
 * categories — architecture.md §8
 */
exports.up = function up(knex) {
  return knex.schema.createTable('categories', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.string('name', 120).notNullable();
    table.string('slug', 140).notNullable();
    table.datetime('created_at').notNullable();

    table.unique(['slug']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('categories');
};
