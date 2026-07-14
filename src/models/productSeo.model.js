const db = require('../config/db');

const TABLE = 'product_seo';
const MAX_ATTEMPTS = 3;

function findByProductId(productId, trx = db) {
  return trx(TABLE).where({ product_id: productId }).first();
}

// Enqueues a product for processing. Resets attempts/status so an edited
// product re-enters the queue even if a prior run left it 'failed' or
// 'needs_review'. No-ops (returns existing row) if source_hash is unchanged,
// mirroring productEmbedding's re-run gate.
async function enqueue({ productId, sourceHash }, trx = db) {
  const now = new Date();
  const existing = await findByProductId(productId, trx);
  if (existing && existing.source_hash === sourceHash && existing.status !== 'failed') {
    return existing;
  }
  if (existing) {
    await trx(TABLE)
      .where({ product_id: productId })
      .update({ status: 'pending', attempts: 0, source_hash: sourceHash, last_error: null, updated_at: now });
  } else {
    await trx(TABLE).insert({
      product_id: productId,
      status: 'pending',
      attempts: 0,
      source_hash: sourceHash,
      created_at: now,
      updated_at: now,
    });
  }
  return findByProductId(productId, trx);
}

function listPending(limit = 10, trx = db) {
  return trx(TABLE).where({ status: 'pending' }).orderBy('updated_at', 'asc').limit(limit);
}

function markProcessing(productId, trx = db) {
  return trx(TABLE).where({ product_id: productId }).update({ status: 'processing', updated_at: new Date() });
}

function saveResult({ productId, status, seo, geo, schemaMarkup, audit, flags }, trx = db) {
  return trx(TABLE)
    .where({ product_id: productId })
    .update({
      status,
      seo: JSON.stringify(seo ?? null),
      geo: JSON.stringify(geo ?? null),
      schema_markup: JSON.stringify(schemaMarkup ?? null),
      audit: JSON.stringify(audit ?? null),
      flags: JSON.stringify(flags ?? []),
      last_error: null,
      updated_at: new Date(),
    });
}

async function markFailed(productId, error, trx = db) {
  const existing = await findByProductId(productId, trx);
  const attempts = (existing?.attempts ?? 0) + 1;
  return trx(TABLE)
    .where({ product_id: productId })
    .update({
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
      attempts,
      last_error: String(error).slice(0, 2000),
      updated_at: new Date(),
    });
}

module.exports = {
  MAX_ATTEMPTS,
  findByProductId,
  enqueue,
  listPending,
  markProcessing,
  saveResult,
  markFailed,
};
