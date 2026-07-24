/**
 * order_audit_log.actor_user_id — Stripe integration.
 * Nullable: system-initiated status changes (Stripe webhook confirming
 * payment) have no human actor. NULL means "the system did this", distinct
 * from any real admin user id.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('order_audit_log', (table) => {
    table.integer('actor_user_id').unsigned().nullable().alter();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('order_audit_log', (table) => {
    table.integer('actor_user_id').unsigned().notNullable().alter();
  });
};
