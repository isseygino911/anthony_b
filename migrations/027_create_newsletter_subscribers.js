/**
 * newsletter_subscribers — builds the list only (footer subscribe form
 * writes here). Sending campaigns off this list is future scope; no
 * status/unsubscribe-token columns until that's actually built.
 */
exports.up = function up(knex) {
  return knex.schema.createTable('newsletter_subscribers', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.string('email', 255).notNullable();
    table.unique('email');
    table.datetime('subscribed_at').notNullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('newsletter_subscribers');
};
