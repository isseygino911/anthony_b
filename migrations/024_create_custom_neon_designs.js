/**
 * custom_neon_designs — status-queue for the AI neon-preview pipeline,
 * modeled directly on product_seo (020_create_product_seo.js): rows land as
 * 'pending' on submission, scripts/neon-design-worker.js polls for 'pending'
 * rows, calls Gemini's image model, and updates the row in place. See
 * customNeonDesign.service.js for the enqueue/confirm side.
 *
 * Exactly one of user_id / session_id is set (application-enforced), same
 * convention as carts (008_create_carts.js) — anonymous visitors can design
 * before creating an account.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('custom_neon_designs', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.integer('user_id').unsigned().nullable();
    table.specificType('session_id', 'CHAR(36)').nullable();

    table.enu('design_type', ['upload', 'draw', 'text']).notNullable();
    // Shape varies by design_type — upload: {sourceImageUrl}; draw:
    // {strokes, renderedImageUrl}; text: {text, fontFamily, renderedImageUrl}.
    // Every shape carries a flattened image URL that the worker sends to the
    // AI; upload's sourceImageUrl doubles as that image.
    table.json('input_payload').notNullable();

    table.enu('size', ['small', 'medium', 'large']).nullable();
    table.string('neon_color', 32).nullable();
    table.decimal('price', 10, 2).nullable();

    table.string('status', 20).notNullable().defaultTo('pending');
    // pending | processing | ready | needs_review | failed
    table.integer('attempts').unsigned().notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.string('generated_image_url', 1024).nullable();

    table.integer('product_id').unsigned().nullable();
    table.text('admin_notes').nullable();

    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.index(['status']);
    table.index(['user_id']);
    table.index(['session_id']);
    table.index(['product_id']);

    table.foreign('user_id').references('users.id').onDelete('CASCADE');
    table.foreign('session_id').references('anon_sessions.session_id').onDelete('SET NULL');
    table.foreign('product_id').references('products.id').onDelete('SET NULL');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('custom_neon_designs');
};
