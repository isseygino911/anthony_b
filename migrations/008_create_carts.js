/**
 * carts — architecture.md §8 / §6 (cart merge-on-login)
 * Exactly one of session_id / user_id is non-null (application-enforced).
 */
exports.up = function up(knex) {
  return knex.schema.createTable('carts', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('cart_id').unsigned().primary();
    table.specificType('session_id', 'CHAR(36)').nullable();
    table.integer('user_id').unsigned().nullable();
    table.integer('product_id').unsigned().notNullable();
    table.integer('quantity').unsigned().notNullable();
    table.datetime('added_at').notNullable();

    // MySQL treats NULL as distinct per-row in unique indexes, so these two
    // composite uniques only actually constrain the non-null side of each
    // pair — matches architecture.md §8 note verbatim.
    table.unique(['session_id', 'product_id']);
    table.unique(['user_id', 'product_id']);
    table.index(['product_id']);

    table
      .foreign('session_id')
      .references('anon_sessions.session_id')
      .onDelete('SET NULL');
    table
      .foreign('user_id')
      .references('users.id')
      .onDelete('CASCADE');
    table
      .foreign('product_id')
      .references('products.id')
      .onDelete('CASCADE');
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('carts');
};
