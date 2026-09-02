/**
 * orders.status — adds 'pending_quote', the state an order sits in when it
 * contains at least one custom-size neon design (see 038) whose price the
 * business has not set yet.
 *
 * Why a real order rather than a separate "quote" table: the customer has
 * finished designing, given a shipping address and committed to buying, and
 * the admin needs the line items, the address and the audit log the order
 * tables already provide. Modelling it as an order means the admin panel,
 * the customer's order history and the audit trail all work unchanged; only
 * the payment step is deferred.
 *
 * Where it sits in the lifecycle:
 *
 *   pending_quote --(admin sets prices)--> pending_payment --(Stripe)--> processing
 *          |
 *          +--(customer or admin)--> cancelled
 *
 * The transition OUT of pending_quote is admin-only and lives in
 * order.service.js#priceQuote. payment.service.js refuses to create a
 * PaymentIntent while an order is in this state, so there is no way to pay
 * an unpriced order: architecture.md §7.3's "pending_payment -> processing
 * is the only Stripe-driven transition" rule is unchanged by this.
 *
 * Placed after 'pending_payment' in the enum so the natural ordering still
 * reads as a lifecycle. MySQL stores enum values by index, and appending
 * mid-list rewrites the indexes of everything after it — safe here because
 * this MODIFY COLUMN rewrites every row's stored value to match the new
 * ordering as part of the same statement.
 */
const WITH_QUOTE =
  "ENUM('pending_payment', 'pending_quote', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')";
const WITHOUT_QUOTE =
  "ENUM('pending_payment', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded')";

exports.up = function up(knex) {
  return knex.raw(`ALTER TABLE \`orders\` MODIFY COLUMN \`status\` ${WITH_QUOTE} NOT NULL DEFAULT 'pending_payment'`);
};

exports.down = async function down(knex) {
  // An unpriced order cannot be represented once the value is gone, and
  // silently coercing it to '' would leave a broken row the admin panel
  // cannot render. Cancelling is the honest downgrade: the customer was
  // never charged, so nothing is lost but the quote request itself.
  await knex('orders').where({ status: 'pending_quote' }).update({ status: 'cancelled' });
  await knex.raw(`ALTER TABLE \`orders\` MODIFY COLUMN \`status\` ${WITHOUT_QUOTE} NOT NULL DEFAULT 'pending_payment'`);
};
