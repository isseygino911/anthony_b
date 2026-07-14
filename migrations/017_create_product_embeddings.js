/**
 * product_embeddings — one embedding per product for the Gemini product-
 * finding assistant's retrieval pipeline (Stage 1, embedding infra).
 * source_hash gates re-embedding so unchanged products skip a Gemini call —
 * see productEmbeddingSync.service.js.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('product_embeddings', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('product_id').unsigned().notNullable();
    table.json('embedding').notNullable();
    table.string('embedding_model', 60).notNullable();
    table.string('source_hash', 64).notNullable();
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.unique(['product_id']);

    table
      .foreign('product_id')
      .references('products.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('product_embeddings');
};
