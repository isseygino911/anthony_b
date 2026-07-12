/**
 * order_audit_log — architecture.md §8 / §7.1
 */
exports.up = function up(knex) {
  return knex.schema.createTable('order_audit_log', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('order_id').unsigned().notNullable();
    table.integer('actor_user_id').unsigned().notNullable();
    table.string('field_changed', 64).notNullable();
    table.string('old_value', 255).nullable();
    table.string('new_value', 255).notNullable();
    table.string('reason', 500).nullable();
    table.datetime('created_at').notNullable();

    table.index(['order_id']);
    table.index(['created_at']);

    table
      .foreign('order_id')
      .references('orders.id')
      .onDelete('CASCADE');
    // Not called out with an explicit ON DELETE in architecture.md §8, so the
    // table-conventions default applies: "all FKs use ON DELETE RESTRICT
    // unless noted otherwise" (actor is always an admin user; audit trail
    // shouldn't disappear/cascade if that admin account is later deleted).
    table
      .foreign('actor_user_id')
      .references('users.id')
      .onDelete('RESTRICT');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('order_audit_log');
};
