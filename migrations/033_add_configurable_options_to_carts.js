/**
 * Configurable-product cart lines: a flat product still upserts by
 * (identity, product_id) exactly as before (options_hash stays NULL, and
 * MySQL treats NULL as distinct per-row the same way session_id/user_id
 * already do — see 008_create_carts.js). A configurable product instead
 * carries a deterministic SHA-256 hex hash of its selected options
 * (size_inches + sorted option choice keys) in options_hash, so two lines
 * for the same product with different configurations stay separate rows,
 * while re-adding an identical configuration still upserts/increments
 * quantity like today. See cart.service.js for the hashing logic — it must
 * live in exactly one place, never recomputed ad hoc per caller.
 */
exports.up = async function up(knex) {
  const hasOptionsHash = await knex.schema.hasColumn('carts', 'options_hash');
  if (!hasOptionsHash) {
    await knex.schema.alterTable('carts', (table) => {
      table.specificType('options_hash', 'CHAR(64)').nullable();
      table.json('selected_options').nullable();
      table.decimal('size_inches', 8, 2).nullable();
      table.decimal('unit_price', 10, 2).nullable();
    });
  }

  const indexes = (await knex.raw('SHOW INDEX FROM `carts`'))[0].map((row) => row.Key_name);

  // Add the new composite unique index BEFORE dropping the old one — MySQL
  // requires session_id/user_id to stay backed by *some* index for their FKs
  // at all times, and since the new index shares the same leading column,
  // MySQL transparently reassigns the FK to it once the old index is gone.
  if (!indexes.includes('carts_session_id_product_id_options_hash_unique')) {
    await knex.schema.alterTable('carts', (table) => {
      table.unique(['session_id', 'product_id', 'options_hash']);
      table.unique(['user_id', 'product_id', 'options_hash']);
    });
  }

  if (indexes.includes('carts_session_id_product_id_unique')) {
    await knex.raw('ALTER TABLE `carts` DROP INDEX `carts_session_id_product_id_unique`');
    await knex.raw('ALTER TABLE `carts` DROP INDEX `carts_user_id_product_id_unique`');
  }
};

exports.down = async function down(knex) {
  // Same ordering constraint in reverse: add the old index back before
  // dropping the composite one it will take over FK-backing duty from.
  await knex.schema.alterTable('carts', (table) => {
    table.unique(['session_id', 'product_id']);
    table.unique(['user_id', 'product_id']);
  });

  await knex.raw('ALTER TABLE `carts` DROP INDEX `carts_session_id_product_id_options_hash_unique`');
  await knex.raw('ALTER TABLE `carts` DROP INDEX `carts_user_id_product_id_options_hash_unique`');

  await knex.schema.alterTable('carts', (table) => {
    table.dropColumn('options_hash');
    table.dropColumn('selected_options');
    table.dropColumn('size_inches');
    table.dropColumn('unit_price');
  });
};
