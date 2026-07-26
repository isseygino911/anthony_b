/**
 * order_items.selected_options — snapshot of a configurable line's chosen
 * size/options at purchase time (mirrors unit_price already being a price
 * snapshot immune to later product changes, architecture.md §7.1). NULL for
 * plain flat-price products and for adjustment rows. Installation and other
 * flat one-time fees are their own separate 'line' row (product_id set to
 * the same product, quantity 1, unit_price = the flat fee, selected_options
 * NULL) rather than folded into the per-unit price, so quantity changes
 * never multiply a one-time fee.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('order_items', (table) => {
    table.json('selected_options').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('order_items', (table) => {
    table.dropColumn('selected_options');
  });
};
