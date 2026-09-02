/**
 * customer_notifications — the customer-facing counterpart to the admin-only
 * `notifications` table (013/023/037/040).
 *
 * A separate table rather than a user_id column on `notifications`, because
 * the two have genuinely different shapes and audiences: every existing
 * notifications row is a broadcast to whichever admin looks at the bell next
 * (no recipient, is_read is global, routes are requireAdmin), whereas these
 * are addressed to exactly one customer and read by that customer alone.
 * Adding a nullable user_id to the admin table would have made every read
 * path filter on "user_id IS NULL" to stay correct, and one missed filter
 * would leak a customer's message into the admin bell or vice versa.
 *
 * Written today by the custom-size quote flow: the customer is told their
 * order is awaiting a quote, and told again once an admin has priced it and
 * it is ready to pay. `order_id` is what the UI links to; it is nullable so
 * a future non-order notification (a design finished rendering, say) fits
 * here without another migration.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('customer_notifications', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('user_id').unsigned().notNullable();
    table.enu('type', ['quote_requested', 'quote_priced']).notNullable();
    table.integer('order_id').unsigned().nullable();
    table.string('message', 500).notNullable();
    table.boolean('is_read').notNullable().defaultTo(false);
    table.datetime('created_at').notNullable();

    // The only read pattern: this customer's notifications, newest first,
    // optionally unread-only.
    table.index(['user_id', 'is_read', 'created_at']);

    // Deleting an account removes its notifications — unlike contact
    // submissions (036), there is no business history worth preserving here.
    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('order_id').references('orders.id').onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('customer_notifications');
};
