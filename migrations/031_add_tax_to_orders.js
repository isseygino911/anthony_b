/**
 * orders.tax_rate_percent / orders.tax_amount — tax is frozen onto the order
 * at creation time (and recomputed alongside totals whenever an adjustment
 * changes the taxable amount), using whatever site_theme.tax_rate_percent was
 * active at that moment. This intentionally does NOT read site_theme live on
 * every fetch — so historical orders keep the rate that was actually charged
 * even if the admin changes the site-wide rate later.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('orders', (table) => {
    table.decimal('tax_rate_percent', 5, 2).notNullable().defaultTo(0);
    table.decimal('tax_amount', 10, 2).notNullable().defaultTo(0);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('orders', (table) => {
    table.dropColumn('tax_rate_percent');
    table.dropColumn('tax_amount');
  });
};
