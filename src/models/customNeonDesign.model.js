const db = require('../config/db');

const TABLE = 'custom_neon_designs';
const MAX_ATTEMPTS = 3;

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

function findByProductId(productId, trx = db) {
  return trx(TABLE).where({ product_id: productId }).first();
}

// Owner check: a design belongs to the caller if either its user_id matches
// the logged-in user, or its session_id matches the anon session cookie —
// same "exactly one of the two" identity convention as carts.
function belongsToIdentity(row, identity) {
  if (identity.userId != null) return row.user_id === identity.userId;
  if (identity.sessionId) return row.session_id === identity.sessionId;
  return false;
}

async function insertDesign({ userId, sessionId, designType, inputPayload, size, neonColor }, trx = db) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    user_id: userId ?? null,
    session_id: sessionId ?? null,
    design_type: designType,
    input_payload: JSON.stringify(inputPayload),
    size,
    neon_color: neonColor,
    status: 'pending',
    attempts: 0,
    created_at: now,
    updated_at: now,
  });
  return findById(id, trx);
}

function listPending(limit = 10, trx = db) {
  return trx(TABLE).where({ status: 'pending' }).orderBy('updated_at', 'asc').limit(limit);
}

function markProcessing(id, trx = db) {
  return trx(TABLE).where({ id }).update({ status: 'processing', updated_at: new Date() });
}

function saveResult({ id, status, generatedImageUrl }, trx = db) {
  return trx(TABLE)
    .where({ id })
    .update({
      status,
      generated_image_url: generatedImageUrl,
      last_error: null,
      updated_at: new Date(),
    });
}

async function markFailed(id, error, trx = db) {
  const existing = await findById(id, trx);
  const attempts = (existing?.attempts ?? 0) + 1;
  return trx(TABLE)
    .where({ id })
    .update({
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      attempts,
      last_error: String(error).slice(0, 2000),
      updated_at: new Date(),
    });
}

// Re-queues for another AI pass ("Re-run AI preview") — resets the status
// queue exactly like productSeoModel.enqueue's re-run path. Optionally
// updates size/neon_color first, so changing either before re-running
// regenerates the preview with the new values rather than the old ones.
function requeue(id, { size, neonColor } = {}, trx = db) {
  return trx(TABLE)
    .where({ id })
    .update({
      ...(size !== undefined ? { size } : {}),
      ...(neonColor !== undefined ? { neon_color: neonColor } : {}),
      status: 'pending',
      attempts: 0,
      last_error: null,
      updated_at: new Date(),
    });
}

function confirm({ id, price, productId }, trx = db) {
  return trx(TABLE)
    .where({ id })
    .update({
      price,
      product_id: productId,
      updated_at: new Date(),
    });
}

function updateAdminNotes(id, adminNotes, trx = db) {
  return trx(TABLE).where({ id }).update({ admin_notes: adminNotes, updated_at: new Date() });
}

// Designs never confirmed into an order (product_id still null) whose
// images haven't already been purged, older than cutoffDate — candidates
// for scripts/neon-design-cleanup.js. The row itself is never deleted, only
// its image URLs (see purgeImages).
function listPurgeCandidates(cutoffDate, limit = 100, trx = db) {
  return trx(TABLE)
    .whereNull('product_id')
    .whereNull('images_purged_at')
    .where('created_at', '<', cutoffDate)
    .limit(limit);
}

// Strips image URLs (S3 objects have already been deleted by the caller by
// this point) while preserving every other field — design_type, size,
// neon_color, status, and any non-image fields in input_payload (text,
// fontFamily, strokes) stay intact forever as the audit record of who
// generated what.
function purgeImages(id, inputPayloadWithoutImages, trx = db) {
  return trx(TABLE)
    .where({ id })
    .update({
      input_payload: JSON.stringify(inputPayloadWithoutImages),
      generated_image_url: null,
      images_purged_at: new Date(),
      updated_at: new Date(),
    });
}

function listAdmin({ status }, { limit, offset }, trx = db) {
  const q = trx(TABLE).select('*').orderBy('created_at', 'desc').limit(limit).offset(offset);
  if (status) q.where({ status });
  return q;
}

function countAdmin({ status }, trx = db) {
  const q = trx(TABLE).count({ count: '*' }).first();
  if (status) q.where({ status });
  return q;
}

module.exports = {
  MAX_ATTEMPTS,
  findById,
  findByProductId,
  belongsToIdentity,
  insertDesign,
  listPending,
  markProcessing,
  saveResult,
  markFailed,
  requeue,
  confirm,
  updateAdminNotes,
  listAdmin,
  countAdmin,
  listPurgeCandidates,
  purgeImages,
};
