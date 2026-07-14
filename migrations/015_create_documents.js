/**
 * documents — downloadable resources (spec sheets/manuals) shown on the
 * storefront's Resources tab and managed from the admin panel, mirroring
 * product_images' upload/delete conventions (architecture.md §8 style).
 */
exports.up = function up(knex) {
  return knex.schema.createTable('documents', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.string('title', 255).notNullable();
    table.string('category', 60).nullable();
    table.string('url', 500).notNullable();
    table.specificType('sort_order', 'SMALLINT UNSIGNED').notNullable().defaultTo(0);
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.index(['category']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('documents');
};
