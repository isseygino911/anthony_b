/**
 * orders.stripe_payment_intent_id — architecture.md §7.3/Stripe integration.
 * Nullable: only populated once checkout reaches
 * POST /api/orders/:id/create-payment-intent. Unique: one PaymentIntent must
 * never be shared by two orders — the webhook trusts this column to look up
 * exactly one order to mark paid, so a duplicate here would let it flip the
 * wrong order to 'processing'.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('orders', (table) => {
    table.string('stripe_payment_intent_id', 255).nullable();
    table.unique(['stripe_payment_intent_id']);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('orders', (table) => {
    table.dropUnique(['stripe_payment_intent_id']);
    table.dropColumn('stripe_payment_intent_id');
  });
};
