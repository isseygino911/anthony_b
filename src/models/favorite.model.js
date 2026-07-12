const db = require('../config/db');

const TABLE = 'favorites';

function listForUser(userId, trx = db) {
  return trx({ f: TABLE })
    .join('products as p', 'p.id', 'f.product_id')
    .where('f.user_id', userId)
    .whereNull('p.deleted_at')
    .select(
      'p.*',
      trx.raw(
        '(SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1) as primary_image_url'
      )
    );
}

function exists(userId, productId, trx = db) {
  return trx(TABLE).where({ user_id: userId, product_id: productId }).first();
}

function insertFavorite(userId, productId, trx = db) {
  return trx(TABLE).insert({ user_id: userId, product_id: productId, created_at: new Date() });
}

function deleteFavorite(userId, productId, trx = db) {
  return trx(TABLE).where({ user_id: userId, product_id: productId }).del();
}

module.exports = { listForUser, exists, insertFavorite, deleteFavorite };
