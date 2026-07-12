/**
 * users — architecture.md §8
 */
exports.up = function up(knex) {
  return knex.schema.createTable('users', (table) => {
    table.charset('utf8mb4');
    table.collate('utf8mb4_unicode_ci');

    table.increments('id').unsigned().primary();
    table.string('email', 255).notNullable();
    table.string('password_hash', 255).nullable();
    table.enu('provider', ['local', 'google']).notNullable();
    table.string('provider_id', 255).nullable();
    table.string('name', 255).notNullable();
    table.enu('role', ['customer', 'admin']).notNullable().defaultTo('customer');
    table.datetime('created_at').notNullable();
    table.datetime('updated_at').notNullable();

    table.unique(['email']);
    // MySQL treats NULL as distinct in unique indexes, so this naturally
    // behaves as "unique where provider_id IS NOT NULL" (architecture.md §8).
    table.unique(['provider', 'provider_id']);
  });
};

exports.down = function down(knex) {
  return knex.schema.dropTableIfExists('users');
};
