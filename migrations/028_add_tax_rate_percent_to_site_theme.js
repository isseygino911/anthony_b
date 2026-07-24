/**
 * Adds the single site-wide tax rate percentage (e.g. 8.25) to site_theme,
 * alongside brand_name/tagline/logo_url as one more piece of the single
 * site-config row. Used to compute the tax line on invoices.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('site_theme', (table) => {
    table.decimal('tax_rate_percent', 5, 2).notNullable().defaultTo(0);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('site_theme', (table) => {
    table.dropColumn('tax_rate_percent');
  });
};
