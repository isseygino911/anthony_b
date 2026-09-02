const crypto = require('crypto');
const db = require('../config/db');
const cartModel = require('../models/cart.model');
const productModel = require('../models/product.model');
const pricingService = require('./pricing.service');
const ApiError = require('../utils/apiError');
const { signImageUrl } = require('../utils/signedImageUrl');

// Deterministic hash of a configurable line's selections — identical
// selections always upsert/increment the same cart row; any different
// selection (size or a single option choice) becomes its own row
// (migrations/033). Sorting choiceKeysByGroupKey's entries makes the hash
// independent of client key ordering.
function hashSelections(selections) {
  const sortedChoices = Object.entries(selections.choiceKeysByGroupKey || {}).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const canonical = JSON.stringify({ sizeInches: selections.sizeInches ?? null, choices: sortedChoices });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// architecture.md §6 — cart merge-on-login algorithm. Matches rows by
// (product_id, options_hash), not product_id alone — two rows for the same
// configurable product with different selections (e.g. different sizes)
// must stay distinct lines after merge, not collapse into one with a
// meaningless combined quantity/price (migrations/033). Plain products keep
// merging exactly as before since their options_hash is always null.
async function mergeAnonCartIntoUser(sessionId, userId, trx) {
  if (!sessionId) return; // no anon session cookie present -> nothing to merge

  const anonRows = await cartModel.findAnonRows(sessionId, trx);
  if (!anonRows.length) return; // idempotent: empty anon cart -> no-op

  const userRows = await cartModel.findUserRows(userId, trx);
  const userRowByKey = new Map(userRows.map((row) => [`${row.product_id}:${row.options_hash ?? ''}`, row]));

  // eslint-disable-next-line no-restricted-syntax
  for (const anonRow of anonRows) {
    const matchingUserRow = userRowByKey.get(`${anonRow.product_id}:${anonRow.options_hash ?? ''}`);
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

function parseJsonColumn(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function shapeCart(rows) {
  const items = await Promise.all(
    rows.map(async (row) => {
      // Configured lines carry their own frozen per-unit price
      // (cart.model.js's unit_price column) computed at add-to-cart time;
      // plain products always use the live product price, same as before.
      const price = row.configured_unit_price != null ? Number(row.configured_unit_price) : Number(row.price);
      const selectedOptions = parseJsonColumn(row.selected_options);
      // Flat one-time fees (e.g. installation) apply once per line, never
      // multiplied by quantity — see order.service.js's matching split into
      // a separate order_items row at checkout.
      const flatFeeTotal = Number(selectedOptions?.flatFeeDelta) || 0;
      // A custom-size neon design has no price yet (products.is_quote, see
      // migration 042). Its stored price is 0.00 only because the column is
      // NOT NULL, so it is reported as null here — the storefront renders
      // "Pricing TBD" and cannot mistake it for a free item.
      const isQuote = Boolean(row.is_quote);
      return {
        cartId: row.cart_id,
        productId: row.product_id,
        name: row.name,
        price: isQuote ? null : price,
        isQuote,
        quantity: row.quantity,
        flatFeeTotal,
        selectedOptions,
        sizeInches: row.size_inches != null ? Number(row.size_inches) : null,
        imageUrl: await signImageUrl(row.image_url || null),
      };
    }),
  );
  // Quote items contribute nothing to the subtotal — their price is unknown,
  // not zero. hasQuoteItems is what tells the storefront the displayed
  // subtotal is partial and that checkout will collect contact details
  // instead of taking payment.
  const subtotal = items.reduce(
    (sum, item) => (item.isQuote ? sum : sum + item.price * item.quantity + item.flatFeeTotal),
    0
  );
  return {
    items,
    subtotal: Number(subtotal.toFixed(2)),
    hasQuoteItems: items.some((item) => item.isQuote),
  };
}

async function getCart(identityInput) {
  const identity = toIdentity(identityInput);
  const rows = await cartModel.listWithProducts(identity);
  return shapeCart(rows);
}

// `snapshot` attaches a selected_options blob to a plain (non-configurable)
// product's line. Configurable products build theirs from `selections` via
// pricing.service; a custom neon design has no pricing_config but still has
// attributes worth freezing onto the order (size, dimensions, colour), so it
// passes a ready-made snapshot here instead. Ignored for configurable
// products, which always derive their own.
async function addItem(identityInput, productId, quantity, selections = null, snapshot = null) {
  const identity = toIdentity(identityInput);
  const product = await productModel.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');

  if (pricingService.isConfigurable(product)) {
    if (!selections) throw ApiError.badRequest('This product requires selectedOptions/sizeInches');
    const priced = await pricingService.computePrice(product, selections);
    const optionsHash = hashSelections(selections);

    await db.transaction(async (trx) => {
      const existing = await cartModel.findRowByIdentityProductAndOptions(identity, productId, optionsHash, trx);
      if (existing) {
        await cartModel.updateQuantity(existing.cart_id, existing.quantity + quantity, trx);
      } else {
        await cartModel.insertRow(identity, productId, quantity, {
          optionsHash,
          selectedOptions: priced.selectedOptionsSnapshot,
          sizeInches: selections.sizeInches ?? null,
          unitPrice: priced.unitPrice,
        }, trx);
      }
    });

    return getCart(identityInput);
  }

  await db.transaction(async (trx) => {
    const existing = await cartModel.findRowByIdentityAndProduct(identity, productId, trx);
    if (existing) {
      await cartModel.updateQuantity(existing.cart_id, existing.quantity + quantity, trx);
    } else {
      await cartModel.insertRow(identity, productId, quantity, snapshot ? { selectedOptions: snapshot } : {}, trx);
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

// Cart-line-scoped variants — required for configurable products, where the
// same productId can appear as multiple distinct lines (different
// size/options), so a lookup by productId alone is ambiguous. Flat products
// may also use these safely since cart_id is always unique per row.
async function assertOwnedRow(identityInput, cartId) {
  const identity = toIdentity(identityInput);
  const row = await cartModel.findById(cartId);
  if (!row) throw ApiError.notFound('Cart item not found');
  const owned = identity.userId ? row.user_id === identity.userId : row.session_id === identity.sessionId;
  if (!owned) throw ApiError.notFound('Cart item not found');
  return row;
}

async function updateItemQuantityByCartId(identityInput, cartId, quantity) {
  await assertOwnedRow(identityInput, cartId);
  if (quantity <= 0) {
    await cartModel.deleteRow(cartId);
  } else {
    await cartModel.updateQuantity(cartId, quantity);
  }
  return getCart(identityInput);
}

async function removeItemByCartId(identityInput, cartId) {
  await assertOwnedRow(identityInput, cartId);
  await cartModel.deleteRow(cartId);
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
  updateItemQuantityByCartId,
  removeItemByCartId,
  clearCart,
};
