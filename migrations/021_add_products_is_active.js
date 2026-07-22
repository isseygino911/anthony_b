/**
 * products.is_active — reversible admin take-down flag (architecture.md §8).
 * Distinct from `deleted_at` (soft-delete): a disabled product stays fully
 * intact and manageable in the admin dashboard, it just disappears from
 * public list/detail responses until an admin re-enables ("reposts") it.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('products', (table) => {
    table.boolean('is_active').notNullable().defaultTo(true);
    table.index(['is_active']);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('products', (table) => {
    table.dropIndex(['is_active']);
    table.dropColumn('is_active');
  });
};
