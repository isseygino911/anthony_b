const orderService = require('../services/order.service');
const asyncHandler = require('../utils/asyncHandler');

const createOrder = asyncHandler(async (req, res) => {
  const { shippingAddress } = req.body;
  const order = await orderService.createOrder(req.user.id, shippingAddress);
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

module.exports = { createOrder, listMyOrders, getMyOrder, listOrdersAdmin, getOrderAdmin, patchOrderAdmin };
