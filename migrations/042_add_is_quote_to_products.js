/**
 * products.is_quote — marks a product whose price is not yet known.
 *
 * Set only by customNeonDesign.service.js#confirmDesign when the customer
 * chose the custom size (see 038). Such a product is created at price 0.00
 * because products.price is NOT NULL, and this flag is what stops that 0
 * from being read as "free": order.service.js holds any order containing a
 * flagged line at 'pending_quote' (039) instead of computing a total and
 * charging it, and the storefront renders "Pricing TBD" rather than $0.00.
 *
 * A boolean on products rather than a nullable price, because making
 * products.price nullable would push a null check into every pricing path in
 * the catalogue — cart totals, order lines, analytics, the product list —
 * to fix a state only this one flow can produce.
 *
 * Cleared by the admin at pricing time, in the same transaction that sets
 * the real price and moves the order to pending_payment.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('products', (table) => {
    table.boolean('is_quote').notNullable().defaultTo(false).after('price');
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('products', (table) => {
    table.dropColumn('is_quote');
  });
};
