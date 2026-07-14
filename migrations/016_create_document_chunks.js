/**
 * document_chunks — chunked + embedded PDF text for the Gemini product-
 * finding assistant's retrieval pipeline (Stage 1, embedding infra).
 * Replace-all per document_id on re-index — see documentIndexing.service.js.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('document_chunks', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('document_id').unsigned().notNullable();
    table.specificType('chunk_index', 'SMALLINT UNSIGNED').notNullable();
    table.text('content').notNullable();
    table.json('embedding').notNullable();
    table.string('embedding_model', 60).notNullable();
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.index(['document_id']);

    table
      .foreign('document_id')
      .references('documents.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('document_chunks');
};
