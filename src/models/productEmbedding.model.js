const db = require('../config/db');

const TABLE = 'product_embeddings';

function findByProductId(productId, trx = db) {
  return trx(TABLE).where({ product_id: productId }).first();
}

async function upsertForProduct({ productId, embedding, model, sourceHash }, trx = db) {
  const now = new Date();
  const existing = await findByProductId(productId, trx);
  if (existing) {
    await trx(TABLE)
      .where({ product_id: productId })
      .update({ embedding: JSON.stringify(embedding), embedding_model: model, source_hash: sourceHash, updated_at: now });
  } else {
    await trx(TABLE).insert({
      product_id: productId,
      embedding: JSON.stringify(embedding),
      embedding_model: model,
      source_hash: sourceHash,
      created_at: now,
      updated_at: now,
    });
  }
  return findByProductId(productId, trx);
}

function listAllWithEmbeddings(trx = db) {
  return trx(TABLE).select('*');
}

module.exports = {
  findByProductId,
  upsertForProduct,
  listAllWithEmbeddings,
};
