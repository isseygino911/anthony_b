const db = require('../config/db');

const TABLE = 'product_option_groups';

function listByProductId(productId, trx = db) {
  return trx(TABLE).where({ product_id: productId }).orderBy('sort_order', 'asc');
}

function listByProductIds(productIds, trx = db) {
  if (!productIds.length) return Promise.resolve([]);
  return trx(TABLE).whereIn('product_id', productIds).orderBy('sort_order', 'asc');
}

function deleteByProductId(productId, trx) {
  return trx(TABLE).where({ product_id: productId }).del();
}

async function insertGroups(productId, groups, trx) {
  const now = new Date();
  const ids = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const group of groups) {
    // eslint-disable-next-line no-await-in-loop
    const [id] = await trx(TABLE).insert({
      product_id: productId,
      key: group.key,
      label: group.label,
      type: group.type || 'single_select',
      sort_order: group.sortOrder ?? 0,
      created_at: now,
      updated_at: now,
    });
    ids.push(id);
  }
  return ids;
}

module.exports = {
  listByProductId,
  listByProductIds,
  deleteByProductId,
  insertGroups,
};
