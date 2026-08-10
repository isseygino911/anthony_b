/**
 * custom_neon_designs.is_showcased — admin curation flag for the public
 * galleries. Before this, listShowcase() published every customer design the
 * moment it reached 'ready', so anything generated on the storefront appeared
 * on the landing page unreviewed. Opt-in (defaults false) rather than opt-out
 * like products.is_active: a design earns its place in the gallery, it is not
 * published until an admin objects.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('custom_neon_designs', (table) => {
    table.boolean('is_showcased').notNullable().defaultTo(false);
    table.index(['is_showcased']);
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('custom_neon_designs', (table) => {
    table.dropIndex(['is_showcased']);
    table.dropColumn('is_showcased');
  });
};
