/**
 * categories.is_internal — marks categories that exist purely for internal
 * bookkeeping (e.g. the synthetic "Custom Neon Signs" category minted below,
 * used to hold one-off custom-manufactured products) and must never appear
 * in storefront nav/browsing. Mirrors products.is_active
 * (021_add_products_is_active.js): the row is real and queryable, it's just
 * filtered out of public-facing listings.
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('categories', (table) => {
    table.boolean('is_internal').notNullable().defaultTo(false);
    table.index(['is_internal']);
  });

  const existing = await knex('categories').where({ slug: 'custom-neon-signs' }).first();
  if (!existing) {
    await knex('categories').insert({
      name: 'Custom Neon Signs',
      slug: 'custom-neon-signs',
      is_internal: true,
      created_at: new Date(),
    });
  }
};

exports.down = async function down(knex) {
  await knex('categories').where({ slug: 'custom-neon-signs' }).del();
  await knex.schema.alterTable('categories', (table) => {
    table.dropIndex(['is_internal']);
    table.dropColumn('is_internal');
  });
};
