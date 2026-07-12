const db = require('../config/db');

const TABLE = 'product_group_items';

function listProductsForGroup(groupId, { limit, offset }, trx = db) {
  return trx({ p: 'products' })
    .join(`${TABLE} as pgi`, 'pgi.product_id', 'p.id')
    .where('pgi.group_id', groupId)
    .whereNull('p.deleted_at')
    .select(
      'p.*',
      trx.raw(
        '(SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1) as primary_image_url'
      )
    )
    .orderBy('p.created_at', 'desc')
    .limit(limit)
    .offset(offset);
}

async function countProductsForGroup(groupId, trx = db) {
  const row = await trx({ p: 'products' })
    .join(`${TABLE} as pgi`, 'pgi.product_id', 'p.id')
    .where('pgi.group_id', groupId)
    .whereNull('p.deleted_at')
    .count({ count: 'p.id' })
    .first();
  return Number(row.count);
}

async function listGroupIdsForProduct(productId, trx = db) {
  const rows = await trx(TABLE).where({ product_id: productId }).select('group_id');
  return rows.map((row) => row.group_id);
}

async function setProductsForGroup(groupId, productIds, trx) {
  await trx(TABLE).where({ group_id: groupId }).del();
  if (productIds.length) {
    await trx(TABLE).insert(productIds.map((productId) => ({ group_id: groupId, product_id: productId })));
  }
}

async function setGroupsForProduct(productId, groupIds, trx) {
  await trx(TABLE).where({ product_id: productId }).del();
  if (groupIds.length) {
    await trx(TABLE).insert(groupIds.map((groupId) => ({ group_id: groupId, product_id: productId })));
  }
}

module.exports = {
  listProductsForGroup,
  countProductsForGroup,
  listGroupIdsForProduct,
  setProductsForGroup,
  setGroupsForProduct,
};
