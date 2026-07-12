/**
 * Seeds the single default site_theme row (architecture.md §8 — single-row
 * table, application enforces exactly one row).
 */
exports.seed = async function seed(knex) {
  // Re-runnable: clear this seed's own table before reinserting (not a
  // TRUNCATE of the live DB in general — just this one settings row).
  await knex('site_theme').del();

  await knex('site_theme').insert({
    id: 1,
    brand_name: 'Demo Store',
    tagline: 'Quality goods, honestly priced.',
    logo_url: null,
    palette_id: 'ocean',
    custom_colors: null,
    section_styles: JSON.stringify({
      hero: 'gradient',
      featured: 'flat',
      groupBanner: 'gradient',
      footer: 'flat',
    }),
    default_mode: 'auto',
    updated_at: knex.fn.now(),
  });
};
