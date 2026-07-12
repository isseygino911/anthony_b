/**
 * orders — architecture.md §8 / §7 (order model, derived totals)
 */
exports.up = function up(knex) {
  return knex.schema.createTable('orders', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('user_id').unsigned().notNullable();
    table
      .enu('status', [
        'pending_payment',
        'processing',
        'shipped',
        'delivered',
        'cancelled',
        'refunded',
      ])
      .notNullable()
      .defaultTo('pending_payment');
    table.json('shipping_address').notNullable();
    table.decimal('subtotal', 10, 2).notNullable();
    table.decimal('adjustment_total', 10, 2).notNullable().defaultTo(0);
    table.decimal('total', 10, 2).notNullable();
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.index(['user_id']);
    table.index(['status']);
    table.index(['created_at']);

    // No guest checkout (plan §9.4) — orders always belong to a user.
    table
      .foreign('user_id')
      .references('users.id')
      .onDelete('RESTRICT');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('orders');
};
