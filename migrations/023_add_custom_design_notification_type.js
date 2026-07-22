/**
 * notifications.type — adds 'custom_design_ordered', inserted by
 * order.service.js#createOrder (alongside 'low_stock') whenever an order
 * contains a line item minted from a confirmed custom_neon_designs row, so
 * admins know a design needs manufacturing once it's actually been paid for.
 * Knex has no portable "alter enum" helper, so this is a raw MySQL
 * MODIFY COLUMN (matches how enum columns are defined in 013_create_notifications.js).
 */
exports.up = function up(knex) {
  return knex.raw(
    "ALTER TABLE `notifications` MODIFY COLUMN `type` ENUM('low_stock', 'custom_design_ordered') NOT NULL"
  );
};

exports.down = function down(knex) {
  return knex.raw("ALTER TABLE `notifications` MODIFY COLUMN `type` ENUM('low_stock') NOT NULL");
};
