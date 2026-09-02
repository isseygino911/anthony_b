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

function findById(cartId, trx = db) {
  return trx(TABLE).where({ cart_id: cartId }).first();
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

// optionsHash is null for plain (unconfigured) products — same row-per-product
// upsert behavior as before. For configurable products it's a deterministic
// hash of the selected options (cart.service.js), so re-adding the identical
// configuration upserts/increments quantity while a different configuration
// of the same product becomes its own row (migrations/033).
function findRowByIdentityProductAndOptions(identity, productId, optionsHash, trx = db) {
  return identityWhere(trx(TABLE), identity)
    .where({ product_id: productId, options_hash: optionsHash })
    .first();
}

async function insertRow(identity, productId, quantity, extra = {}, trx = db) {
  const [cartId] = await trx(TABLE).insert({
    session_id: identity.sessionId || null,
    user_id: identity.userId || null,
    product_id: productId,
    quantity,
    added_at: new Date(),
    options_hash: extra.optionsHash ?? null,
    selected_options: extra.selectedOptions ? JSON.stringify(extra.selectedOptions) : null,
    size_inches: extra.sizeInches ?? null,
    unit_price: extra.unitPrice ?? null,
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
      'c.options_hash',
      'c.selected_options',
      'c.size_inches',
      'c.unit_price as configured_unit_price',
      'p.name',
      'p.price',
      // Drives the "Pricing TBD" display and, at checkout, whether the whole
      // order is held at pending_quote — see order.service.js#createOrder.
      'p.is_quote',
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
  findById,
  deleteRow,
  reassignRowToUser,
  findRowByIdentityAndProduct,
  findRowByIdentityProductAndOptions,
  insertRow,
  listWithProducts,
  deleteAllForIdentity,
};
