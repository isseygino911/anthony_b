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
  const { productId, quantity } = req.body;
  const cart = await cartService.addItem(identityFromReq(req), Number(productId), Number(quantity));
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

const clearCart = asyncHandler(async (req, res) => {
  await cartService.clearCart(identityFromReq(req));
  res.status(204).end();
});

module.exports = { getCart, addItem, updateItem, removeItem, clearCart };
