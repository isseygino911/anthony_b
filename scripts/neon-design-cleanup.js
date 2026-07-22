/**
 * One-shot maintenance script: deletes the S3 images (source input +
 * AI-generated preview) for any custom_neon_designs row that was never
 * confirmed into an order (product_id still null) and is older than
 * NEON_DESIGN_RETENTION_HOURS — cost/storage cleanup for abandoned designs.
 *
 * The database row itself is NEVER deleted — only its image URLs are
 * cleared and images_purged_at is stamped, so "who generated what and when"
 * remains a permanent audit trail tied to the user, per product decision.
 * Non-image fields (design_type, size, neon_color, and non-image parts of
 * input_payload like text/fontFamily/strokes) are left untouched.
 *
 * Meant to be run periodically via cron/PM2 cron_restart (it runs once and
 * exits), not as a long-lived daemon like neon-design-worker.js.
 *
 * Usage: node scripts/neon-design-cleanup.js
 */
const db = require('../src/config/db');
const uploadService = require('../src/services/upload.service');
const customNeonDesignModel = require('../src/models/customNeonDesign.model');

const RETENTION_HOURS = Number(process.env.NEON_DESIGN_RETENTION_HOURS) || 48;
const BATCH_LIMIT = 200;

function parsePayload(payload) {
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

function stripImageUrls(payload) {
  const { sourceImageUrl, renderedImageUrl, ...rest } = payload;
  return rest;
}

async function purgeRow(row) {
  const payload = parsePayload(row.input_payload);
  const imageUrls = [payload.sourceImageUrl, payload.renderedImageUrl, row.generated_image_url].filter(Boolean);

  // eslint-disable-next-line no-restricted-syntax
  for (const url of imageUrls) {
    // eslint-disable-next-line no-await-in-loop
    await uploadService.deleteObjectByUrl(url);
  }

  await customNeonDesignModel.purgeImages(row.id, stripImageUrls(payload));
  console.log(`[neon-design-cleanup] design ${row.id} -> images purged (${imageUrls.length} object(s))`);
}

async function run() {
  const cutoffDate = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000);
  let totalPurged = 0;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const candidates = await customNeonDesignModel.listPurgeCandidates(cutoffDate, BATCH_LIMIT);
    if (!candidates.length) break;

    // eslint-disable-next-line no-restricted-syntax
    for (const row of candidates) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await purgeRow(row);
        totalPurged += 1;
      } catch (err) {
        console.error(`[neon-design-cleanup] design ${row.id} failed`, err);
      }
    }

    if (candidates.length < BATCH_LIMIT) break;
  }

  console.log(`[neon-design-cleanup] done — purged ${totalPurged} design(s) older than ${RETENTION_HOURS}h`);
}

if (require.main === module) {
  run()
    .catch((err) => {
      console.error('[neon-design-cleanup] run failed', err);
      process.exitCode = 1;
    })
    .finally(() => db.destroy());
}

module.exports = { run, purgeRow };
