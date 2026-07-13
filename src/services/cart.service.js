const db = require('../config/db');
const cartModel = require('../models/cart.model');
const productModel = require('../models/product.model');
const ApiError = require('../utils/apiError');
const { signImageUrl } = require('../utils/signedImageUrl');

// architecture.md §6 — cart merge-on-login algorithm, verbatim. Called from
// auth.service.js on register/login/OAuth callback, never reimplemented per
// auth method.
async function mergeAnonCartIntoUser(sessionId, userId, trx) {
  if (!sessionId) return; // no anon session cookie present -> nothing to merge

  const anonRows = await cartModel.findAnonRows(sessionId, trx);
  if (!anonRows.length) return; // idempotent: empty anon cart -> no-op

  const userRows = await cartModel.findUserRows(userId, trx);
  const userRowByProduct = new Map(userRows.map((row) => [row.product_id, row]));

  // eslint-disable-next-line no-restricted-syntax
  for (const anonRow of anonRows) {
    const matchingUserRow = userRowByProduct.get(anonRow.product_id);
    if (matchingUserRow) {
      // eslint-disable-next-line no-await-in-loop
      await cartModel.updateQuantity(
        matchingUserRow.cart_id,
        matchingUserRow.quantity + anonRow.quantity,
        trx
      );
      // eslint-disable-next-line no-await-in-loop
      await cartModel.deleteRow(anonRow.cart_id, trx);
    } else {
      // eslint-disable-next-line no-await-in-loop
      await cartModel.reassignRowToUser(anonRow.cart_id, userId, trx);
    }
  }
}

function toIdentity({ user, anonSessionId }) {
  if (user) return { userId: user.id };
  if (anonSessionId) return { sessionId: anonSessionId };
  throw ApiError.badRequest('No cart identity available');
}

async function shapeCart(rows) {
  const items = await Promise.all(
    rows.map(async (row) => ({
      productId: row.product_id,
      name: row.name,
      price: Number(row.price),
      quantity: row.quantity,
      imageUrl: await signImageUrl(row.image_url || null),
    })),
  );
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return { items, subtotal: Number(subtotal.toFixed(2)) };
}

async function getCart(identityInput) {
  const identity = toIdentity(identityInput);
  const rows = await cartModel.listWithProducts(identity);
  return shapeCart(rows);
}

async function addItem(identityInput, productId, quantity) {
  const identity = toIdentity(identityInput);
  const product = await productModel.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');

  await db.transaction(async (trx) => {
    const existing = await cartModel.findRowByIdentityAndProduct(identity, productId, trx);
    if (existing) {
      await cartModel.updateQuantity(existing.cart_id, existing.quantity + quantity, trx);
    } else {
      await cartModel.insertRow(identity, productId, quantity, trx);
    }
  });

  return getCart(identityInput);
}

async function updateItemQuantity(identityInput, productId, quantity) {
  const identity = toIdentity(identityInput);
  const existing = await cartModel.findRowByIdentityAndProduct(identity, productId);
  if (existing) {
    if (quantity <= 0) {
      await cartModel.deleteRow(existing.cart_id);
    } else {
      await cartModel.updateQuantity(existing.cart_id, quantity);
    }
  }
  return getCart(identityInput);
}

async function removeItem(identityInput, productId) {
  const identity = toIdentity(identityInput);
  const existing = await cartModel.findRowByIdentityAndProduct(identity, productId);
  if (existing) await cartModel.deleteRow(existing.cart_id);
  return getCart(identityInput);
}

async function clearCart(identityInput) {
  const identity = toIdentity(identityInput);
  await cartModel.deleteAllForIdentity(identity);
}

module.exports = {
  mergeAnonCartIntoUser,
  getCart,
  addItem,
  updateItemQuantity,
  removeItem,
  clearCart,
};
