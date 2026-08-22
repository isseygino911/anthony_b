/**
 * notifications.type — adds 'contact_submission', inserted by
 * contact.service.js#submit whenever a visitor sends a message through one
 * of the storefront contact forms, so the existing admin notification bell
 * surfaces new enquiries without the admin having to poll the Contact page.
 *
 * Same raw MODIFY COLUMN approach (and rationale) as 023: Knex has no
 * portable alter-enum helper, and the column was declared with table.enu()
 * in 013_create_notifications.js.
 */
exports.up = function up(knex) {
  return knex.raw(
    "ALTER TABLE `notifications` MODIFY COLUMN `type` ENUM('low_stock', 'custom_design_ordered', 'contact_submission') NOT NULL"
  );
};

exports.down = function down(knex) {
  return knex.raw(
    "ALTER TABLE `notifications` MODIFY COLUMN `type` ENUM('low_stock', 'custom_design_ordered') NOT NULL"
  );
};
