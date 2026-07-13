const db = require('../config/db');

const TABLE = 'carts';

// `identity` is always exactly one of {userId} or {sessionId}.
function identityWhere(query, identity) {
  if (identity.userId) return query.where({ user_id: identity.userId });
  return query.where({ session_id: identity.sessionId });
}

function findAnonRows(sessionId, trx) {
  return trx(TABLE).where({ session_id: sessionId }).whereNull('user_id');
}

function findUserRows(userId, trx) {
  return trx(TABLE).where({ user_id: userId });
}

function updateQuantity(cartId, quantity, trx = db) {
  return trx(TABLE).where({ cart_id: cartId }).update({ quantity });
}

function deleteRow(cartId, trx = db) {
  return trx(TABLE).where({ cart_id: cartId }).del();
}

function reassignRowToUser(cartId, userId, trx) {
  return trx(TABLE).where({ cart_id: cartId }).update({ user_id: userId, session_id: null });
}

function findRowByIdentityAndProduct(identity, productId, trx = db) {
  return identityWhere(trx(TABLE), identity).where({ product_id: productId }).first();
}

async function insertRow(identity, productId, quantity, trx = db) {
  const [cartId] = await trx(TABLE).insert({
    session_id: identity.sessionId || null,
    user_id: identity.userId || null,
    product_id: productId,
    quantity,
    added_at: new Date(),
  });
  return cartId;
}

function listWithProducts(identity, trx = db) {
  return identityWhere(trx({ c: TABLE }), identity)
    .join('products as p', 'p.id', 'c.product_id')
    .whereNull('p.deleted_at')
    .select(
      'c.cart_id',
      'c.product_id',
      'c.quantity',
      'p.name',
      'p.price',
      trx.raw(
        '(SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1) as image_url'
      )
    );
}

function deleteAllForIdentity(identity, trx = db) {
  return identityWhere(trx(TABLE), identity).del();
}

module.exports = {
  findAnonRows,
  findUserRows,
  updateQuantity,
  deleteRow,
  reassignRowToUser,
  findRowByIdentityAndProduct,
  insertRow,
  listWithProducts,
  deleteAllForIdentity,
};
