/**
 * custom_neon_designs — adds the fourth, customer-specified size option.
 *
 * The three preset sizes (small/medium/large) have fixed prices in
 * customNeonDesign.service.js's SIZE_PRICES. A custom size has no price the
 * business can compute up front, so a design on this path is quoted by hand:
 * it still generates an AI preview and still becomes an order, but with
 * price NULL until an admin sets one (see 039 for the order side).
 *
 * `size` gains 'custom' via a raw MODIFY COLUMN for the same reason as 023
 * and 037: Knex has no portable alter-enum helper and the column was
 * declared with table.enu() in 024. It stays NULLABLE exactly as before.
 *
 * The two dimension columns are only populated when size = 'custom'
 * (application-enforced in assertSizeAndDimensions) and are NULL for every
 * preset row, existing or future — the preset's dimensions are already
 * described by SIZE_DIMENSIONS and would be duplicated state here.
 *
 * DECIMAL(6,2) inches rather than a free-text string: the value is compared
 * against MIN/MAX bounds, rendered back to the customer, and passed to the
 * AI prompt, so it needs to be a number. 6,2 comfortably covers the
 * 1–240 inch range the service enforces.
 *
 * price is already NULLABLE from 024, so the "no price yet" state needs no
 * schema change — only the code paths that previously assumed a preset.
 */
exports.up = async function up(knex) {
  await knex.raw(
    "ALTER TABLE `custom_neon_designs` MODIFY COLUMN `size` ENUM('small', 'medium', 'large', 'custom') NULL"
  );
  await knex.schema.alterTable('custom_neon_designs', (table) => {
    table.decimal('custom_width_in', 6, 2).nullable().after('size');
    table.decimal('custom_height_in', 6, 2).nullable().after('custom_width_in');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('custom_neon_designs', (table) => {
    table.dropColumn('custom_width_in');
    table.dropColumn('custom_height_in');
  });
  // Any custom-size rows must go before the enum can lose the value, or MySQL
  // silently coerces them to ''. Deleting is correct here: such a design has
  // no valid representation in the pre-migration schema.
  await knex('custom_neon_designs').where({ size: 'custom' }).del();
  await knex.raw(
    "ALTER TABLE `custom_neon_designs` MODIFY COLUMN `size` ENUM('small', 'medium', 'large') NULL"
  );
};
