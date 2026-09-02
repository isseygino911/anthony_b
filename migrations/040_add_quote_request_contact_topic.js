/**
 * Adds the 'quote_request' contact surface — the form a customer fills in
 * when they order a custom-size neon design (see 038/039). It reuses the
 * existing contact_submissions table for exactly the reason 036 anticipated:
 * "adding a new contact surface later means extending this enum via a MODIFY
 * COLUMN migration plus a new entry in the frontend's TOPIC config".
 *
 * Same shape as the installer/designer surfaces, so the admin Contact page
 * lists, filters and works these enquiries with no new screen. What differs
 * is that a quote_request row is created by the checkout flow rather than by
 * a visitor browsing to a form, and it is the record the admin works from to
 * price the order.
 *
 * notifications.type gains 'quote_requested' alongside it (extending the
 * enum last touched by 037). The existing 'contact_submission' type is
 * deliberately NOT reused: the admin needs to tell "someone sent us a
 * message" apart from "an order is sitting unpriced and the customer is
 * waiting", because only the second one blocks a purchase.
 */
exports.up = async function up(knex) {
  await knex.raw(
    "ALTER TABLE `contact_submissions` MODIFY COLUMN `topic` ENUM('installer', 'designer', 'quote_request') NOT NULL"
  );
  await knex.raw(
    "ALTER TABLE `notifications` MODIFY COLUMN `type` ENUM('low_stock', 'custom_design_ordered', 'contact_submission', 'quote_requested') NOT NULL"
  );
};

exports.down = async function down(knex) {
  // Drop the rows that can no longer be represented before narrowing the
  // enums, so MySQL never coerces them to ''.
  await knex('contact_submissions').where({ topic: 'quote_request' }).del();
  await knex('notifications').where({ type: 'quote_requested' }).del();
  await knex.raw(
    "ALTER TABLE `contact_submissions` MODIFY COLUMN `topic` ENUM('installer', 'designer') NOT NULL"
  );
  await knex.raw(
    "ALTER TABLE `notifications` MODIFY COLUMN `type` ENUM('low_stock', 'custom_design_ordered', 'contact_submission') NOT NULL"
  );
};
