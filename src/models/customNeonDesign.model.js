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

// Rows left at 'processing' by a worker that died mid-processRow (killed,
// OOM, crash) would otherwise be stuck forever — listPending() only ever
// re-picks up 'pending' rows. Reclaiming anything past a generous timeout
// (far longer than a normal Gemini call) back to 'pending' lets the next
// tick retry it through the normal attempts/markFailed path.
const STUCK_PROCESSING_TIMEOUT_MINUTES = 5;

function reclaimStuckProcessing(trx = db) {
  return trx(TABLE)
    .where({ status: 'processing' })
    .andWhere('updated_at', '<', trx.raw(`NOW() - INTERVAL ${STUCK_PROCESSING_TIMEOUT_MINUTES} MINUTE`))
    .update({ status: 'pending', updated_at: new Date() });
}

// An identity (logged-in user or anon session) may only have one design
// generating at a time (createDesign/regenerate both enforce this) — used
// both to block a second concurrent generation and to let the frontend
// find/reattach to an in-progress design after a refresh or on a fresh page
// load.
function findActiveByUserId(userId, trx = db) {
  return trx(TABLE).whereIn('status', ['pending', 'processing']).andWhere({ user_id: userId }).first();
}

function findActiveBySessionId(sessionId, trx = db) {
  return trx(TABLE).whereIn('status', ['pending', 'processing']).andWhere({ session_id: sessionId }).first();
}

// Customer-facing "My Designs" list — every design the caller has ever
// generated, regardless of status, newest first.
function listMine(userId, { limit, offset }, trx = db) {
  return trx(TABLE).where({ user_id: userId }).orderBy('created_at', 'desc').limit(limit).offset(offset);
}

function countMine(userId, trx = db) {
  return trx(TABLE).where({ user_id: userId }).count({ count: '*' }).first();
}

function listMineBySessionId(sessionId, { limit, offset }, trx = db) {
  return trx(TABLE).where({ session_id: sessionId }).orderBy('created_at', 'desc').limit(limit).offset(offset);
}

function countMineBySessionId(sessionId, trx = db) {
  return trx(TABLE).where({ session_id: sessionId }).count({ count: '*' }).first();
}

// Claims the designs generated during an anon session for the account that
// session just logged into / registered as. Mirrors
// cartService.mergeAnonCartIntoUser — without it, listMine branches on the
// user half of the identity first and a visitor who designed before signing
// up sees an empty "My Designs". Clearing session_id keeps the
// "exactly one of the two" convention belongsToIdentity relies on.
function reassignSessionToUser(sessionId, userId, trx = db) {
  return trx(TABLE)
    .where({ session_id: sessionId })
    .whereNull('user_id')
    .update({ user_id: userId, session_id: null, updated_at: new Date() });
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

// Promotes/removes a design from the public galleries (see listShowcase).
function setShowcased(id, isShowcased, trx = db) {
  return trx(TABLE).where({ id }).update({ is_showcased: Boolean(isShowcased), updated_at: new Date() });
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

// Public landing-page gallery — most recent finished designs, image-only
// (no input_payload/admin_notes exposed; see customNeonDesign.service.js).
// is_showcased gates it: designs are opt-in, so a customer's generation only
// appears here once an admin promotes it (see setShowcased).
function listShowcase(limit = 10, trx = db) {
  return trx(TABLE)
    .select('id', 'design_type', 'size', 'generated_image_url')
    .where({ status: 'ready', is_showcased: true })
    .whereNotNull('generated_image_url')
    .whereNull('images_purged_at')
    .orderBy('created_at', 'desc')
    .limit(limit);
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

// Per-user generation activity (admin "Custom Neon Usage" tab). Anonymous
// designs (user_id NULL) used to be excluded as a legacy artifact from before
// login was required; since anonymous generation was allowed they are the
// normal case for every signed-out visitor, and dropping them made this tab
// under-report real usage. They group into a single NULL bucket, which the
// service renders as "Anonymous" — individual anon sessions are deliberately
// not broken out, since they are not attributable to a person.
function listUsageByUser({ limit, offset }, trx = db) {
  return trx(TABLE)
    .groupBy('user_id')
    .select('user_id')
    .count({ designCount: '*' })
    .sum({ confirmedCount: trx.raw('CASE WHEN product_id IS NOT NULL THEN 1 ELSE 0 END') })
    .max({ lastGeneratedAt: 'created_at' })
    .orderBy('lastGeneratedAt', 'desc')
    .limit(limit)
    .offset(offset);
}

// COUNT(DISTINCT user_id) skips NULLs, so the anonymous bucket has to be
// added back explicitly or pagination undercounts by one page-worth.
async function countUsageByUser(trx = db) {
  const [distinctRow, anonRow] = await Promise.all([
    trx(TABLE).countDistinct({ count: 'user_id' }).first(),
    trx(TABLE).whereNull('user_id').count({ count: '*' }).first(),
  ]);
  return { count: Number(distinctRow.count) + (Number(anonRow.count) > 0 ? 1 : 0) };
}

module.exports = {
  MAX_ATTEMPTS,
  findById,
  findByProductId,
  belongsToIdentity,
  insertDesign,
  listPending,
  reclaimStuckProcessing,
  findActiveByUserId,
  findActiveBySessionId,
  listMine,
  countMine,
  listMineBySessionId,
  countMineBySessionId,
  reassignSessionToUser,
  markProcessing,
  saveResult,
  markFailed,
  requeue,
  confirm,
  updateAdminNotes,
  setShowcased,
  listShowcase,
  listAdmin,
  countAdmin,
  listPurgeCandidates,
  purgeImages,
  listUsageByUser,
  countUsageByUser,
};
