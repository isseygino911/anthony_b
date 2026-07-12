/**
 * anon_sessions — architecture.md §8
 * Created before `carts` since carts.session_id is a real FK into this table.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('anon_sessions', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.specificType('session_id', 'CHAR(36)').notNullable().primary();
    table.datetime('created_at').notNullable();
    table.datetime('last_seen_at').notNullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('anon_sessions');
};
