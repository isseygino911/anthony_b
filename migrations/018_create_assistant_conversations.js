/**
 * assistant_conversations — Gemini product-finding assistant (Stage 2).
 * Exactly one of user_id / anon_session_id is typically non-null, mirroring
 * carts' session_id/user_id convention, so both guests and logged-in
 * customers can have a conversation.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('assistant_conversations', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('user_id').unsigned().nullable();
    table.specificType('anon_session_id', 'CHAR(36)').nullable();
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table
      .foreign('user_id')
      .references('users.id')
      .onDelete('CASCADE');
    table
      .foreign('anon_session_id')
      .references('anon_sessions.session_id')
      .onDelete('SET NULL');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('assistant_conversations');
};
