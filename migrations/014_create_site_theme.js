/**
 * site_theme — architecture.md §8
 * Single-row table (application enforces exactly one row). No FKs, no
 * indexes beyond PK (read on nearly every request, single row).
 */
exports.up = function up(knex) {
  return knex.schema.createTable('site_theme', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.string('brand_name', 120).notNullable();
    table.string('tagline', 255).nullable();
    table.string('logo_url', 500).nullable();
    table.string('palette_id', 32).notNullable();
    table.json('custom_colors').nullable();
    table.json('section_styles').notNullable();
    table.enu('default_mode', ['light', 'dark', 'auto']).notNullable().defaultTo('auto');
    table.datetime('updated_at').notNullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('site_theme');
};
