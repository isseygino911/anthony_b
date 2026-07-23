/**
 * Adds admin-editable social link URLs to site_theme, alongside brand_name/
 * tagline/logo_url as one more piece of the single site-config row.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('site_theme', (table) => {
    table.json('social_links').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('site_theme', (table) => {
    table.dropColumn('social_links');
  });
};
