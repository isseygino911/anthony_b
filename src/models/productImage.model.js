const db = require('../config/db');

const TABLE = 'product_images';

function listByProductId(productId, trx = db) {
  return trx(TABLE).where({ product_id: productId }).orderBy('sort_order', 'asc');
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

async function insertImages(rows, trx = db) {
  const now = new Date();
  const prepared = rows.map((row) => ({ ...row, created_at: now }));
  const ids = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const row of prepared) {
    // eslint-disable-next-line no-await-in-loop
    const [id] = await trx(TABLE).insert(row);
    ids.push(id);
  }
  return trx(TABLE).whereIn('id', ids);
}

function unsetPrimaryForProduct(productId, trx) {
  return trx(TABLE).where({ product_id: productId }).update({ is_primary: false });
}

function setPrimary(imageId, trx) {
  return trx(TABLE).where({ id: imageId }).update({ is_primary: true });
}

function deleteById(id, trx = db) {
  return trx(TABLE).where({ id }).del();
}

module.exports = {
  listByProductId,
  findById,
  insertImages,
  unsetPrimaryForProduct,
  setPrimary,
  deleteById,
};
