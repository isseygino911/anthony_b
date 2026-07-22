/**
 * custom_neon_designs.images_purged_at — set by scripts/neon-design-cleanup.js
 * when a design's S3 images (source + AI-generated preview) are deleted for
 * storage/cost reasons because the design was never confirmed into an order
 * within the retention window (NEON_DESIGN_RETENTION_HOURS). The row itself
 * is kept forever as an audit trail of who generated what — only the image
 * bytes are purged, never the record.
 */
exports.up = function up(knex) {
  return knex.schema.alterTable('custom_neon_designs', (table) => {
    table.datetime('images_purged_at').nullable();
  });
};

exports.down = function down(knex) {
  return knex.schema.alterTable('custom_neon_designs', (table) => {
    table.dropColumn('images_purged_at');
  });
};
