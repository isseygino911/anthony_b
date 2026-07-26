const cartService = require('../services/cart.service');
const asyncHandler = require('../utils/asyncHandler');

// Cart routes work for both anonymous (anon_session_id cookie) and logged-in
// (JWT cookie) callers — architecture.md §4.5.
function identityFromReq(req) {
  return { user: req.user, anonSessionId: req.anonSessionId };
}

const getCart = asyncHandler(async (req, res) => {
  const cart = await cartService.getCart(identityFromReq(req));
  res.status(200).json(cart);
});

const addItem = asyncHandler(async (req, res) => {
  const { productId, quantity, selectedOptions, sizeInches } = req.body;
  const selections =
    selectedOptions || sizeInches !== undefined
      ? { choiceKeysByGroupKey: selectedOptions || {}, sizeInches: sizeInches !== undefined ? Number(sizeInches) : undefined }
      : null;
  const cart = await cartService.addItem(identityFromReq(req), Number(productId), Number(quantity), selections);
  res.status(200).json(cart);
});

const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const cart = await cartService.updateItemQuantity(
    identityFromReq(req),
    Number(req.params.productId),
    Number(quantity)
  );
  res.status(200).json(cart);
});

const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItem(identityFromReq(req), Number(req.params.productId));
  res.status(200).json(cart);
});

// Cart-line-scoped variants (by cart_id, not product_id) — required for
// configurable products where the same product can appear as multiple
// distinct lines. See cart.service.js.
const updateItemByCartId = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const cart = await cartService.updateItemQuantityByCartId(
    identityFromReq(req),
    Number(req.params.cartId),
    Number(quantity)
  );
  res.status(200).json(cart);
});

const removeItemByCartId = asyncHandler(async (req, res) => {
  const cart = await cartService.removeItemByCartId(identityFromReq(req), Number(req.params.cartId));
  res.status(200).json(cart);
});

const clearCart = asyncHandler(async (req, res) => {
  await cartService.clearCart(identityFromReq(req));
  res.status(204).end();
});

module.exports = {
  getCart,
  addItem,
  updateItem,
  removeItem,
  updateItemByCartId,
  removeItemByCartId,
  clearCart,
};
