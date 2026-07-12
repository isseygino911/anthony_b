/**
 * product_groups — architecture.md §8
 * The virtual "ALL" group is client-side only — no row, no seed, no special ID.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('product_groups', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.string('name', 120).notNullable();
    table.string('description', 500).nullable();
    table.datetime('created_at').notNullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('product_groups');
};
