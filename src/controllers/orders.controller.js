const orderService = require('../services/order.service');
const asyncHandler = require('../utils/asyncHandler');

const createOrder = asyncHandler(async (req, res) => {
  // `contact` is required only when the cart holds a custom-size item; the
  // service decides that from the cart and validates accordingly, so this
  // stays a straight pass-through.
  const { shippingAddress, contact } = req.body;
  const order = await orderService.createOrder(req.user.id, shippingAddress, contact);
  res.status(201).json(order);
});

const listMyOrders = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const result = await orderService.listOrdersForUser(req.user.id, { page, pageSize });
  res.status(200).json(result);
});

const getMyOrder = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderForRequester(Number(req.params.id), req.user);
  res.status(200).json(order);
});

const cancelMyOrder = asyncHandler(async (req, res) => {
  await orderService.cancelOrder(Number(req.params.id), req.user);
  res.status(204).end();
});

const listOrdersAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));
  const { status, search } = req.query;
  const result = await orderService.listOrdersAdmin({ status, search }, { page, pageSize });
  res.status(200).json(result);
});

const getOrderAdmin = asyncHandler(async (req, res) => {
  const order = await orderService.getOrderAdmin(Number(req.params.id));
  res.status(200).json(order);
});

const patchOrderAdmin = asyncHandler(async (req, res) => {
  const { type, amount, newStatus, reason } = req.body;
  const result = await orderService.applyAdjustment(
    Number(req.params.id),
    { type, amount, newStatus, reason },
    req.user.id
  );
  res.status(200).json(result);
});

// Admin: price a pending_quote order's unpriced lines and release it for
// payment. Separate from patchOrderAdmin because it is the only sanctioned
// way out of pending_quote (see order.service.js#priceQuote).
const priceQuoteAdmin = asyncHandler(async (req, res) => {
  const result = await orderService.priceQuote(Number(req.params.id), req.body.prices, req.user.id);
  res.status(200).json(result);
});

const downloadInvoice = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const doc = await orderService.generateInvoice(orderId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${orderId}.pdf"`);
  doc.pipe(res);
  doc.end();
});

// Fabrication spec sheet — available for any order, at any status (unlike the
// invoice, which is gated on 'delivered'): the workshop needs this before the
// order ships, not after.
const downloadSpecSheet = asyncHandler(async (req, res) => {
  const orderId = Number(req.params.id);
  const doc = await orderService.generateSpecSheet(orderId);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="spec-sheet-${orderId}.pdf"`);
  doc.pipe(res);
  doc.end();
});

module.exports = {
  createOrder,
  listMyOrders,
  getMyOrder,
  cancelMyOrder,
  listOrdersAdmin,
  getOrderAdmin,
  patchOrderAdmin,
  priceQuoteAdmin,
  downloadInvoice,
  downloadSpecSheet,
};
