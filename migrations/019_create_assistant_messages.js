/**
 * assistant_messages — one row per turn in an assistant_conversations thread.
 * cited_product_ids/cited_document_ids only ever hold IDs that survived the
 * read-only re-resolution step in assistant.service.js — never raw model
 * output (Stage 2 architecture note).
 */
exports.up = function up(knex) {
  return knex.schema.createTable('assistant_messages', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('conversation_id').unsigned().notNullable();
    table.enu('role', ['user', 'assistant']).notNullable();
    table.text('content').notNullable();
    table.json('cited_product_ids').nullable();
    table.json('cited_document_ids').nullable();
    table.datetime('created_at').notNullable();

    table.index(['conversation_id']);

    table
      .foreign('conversation_id')
      .references('assistant_conversations.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('assistant_messages');
};
