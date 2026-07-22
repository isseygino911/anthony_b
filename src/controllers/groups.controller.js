const db = require('../config/db');
const productGroupModel = require('../models/productGroup.model');
const productGroupItemModel = require('../models/productGroupItem.model');
const productService = require('../services/product.service');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const isAdminReq = (req) => Boolean(req.user && req.user.role === 'admin');

const listGroups = asyncHandler(async (req, res) => {
  const items = await productGroupModel.listGroups();
  res.status(200).json({ items });
});

const listGroupProducts = asyncHandler(async (req, res) => {
  const groupId = Number(req.params.id);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  const isAdmin = isAdminReq(req);
  const includeInactive = isAdmin && req.query.includeInactive === 'true';
  const [rows, total] = await Promise.all([
    productGroupItemModel.listProductsForGroup(
      groupId,
      { limit: pageSize, offset: (page - 1) * pageSize },
      { includeInactive },
    ),
    productGroupItemModel.countProductsForGroup(groupId, { includeInactive }),
  ]);
  res.status(200).json({
    items: await Promise.all(
      rows.map((row) => productService.shapeProduct(row, { isAdmin, primaryImageUrl: row.primary_image_url })),
    ),
    total,
  });
});

const createGroup = asyncHandler(async (req, res) => {
  const group = await productGroupModel.insertGroup(req.body);
  res.status(201).json(group);
});

const updateGroup = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await productGroupModel.findById(id);
  if (!existing) throw ApiError.notFound('Group not found');
  const group = await productGroupModel.updateGroup(id, req.body);
  res.status(200).json(group);
});

const deleteGroup = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await productGroupModel.findById(id);
  if (!existing) throw ApiError.notFound('Group not found');
  await productGroupModel.deleteGroup(id); // cascades product_group_items only (FK ON DELETE CASCADE)
  res.status(204).end();
});

const setGroupProducts = asyncHandler(async (req, res) => {
  const groupId = Number(req.params.id);
  const existing = await productGroupModel.findById(groupId);
  if (!existing) throw ApiError.notFound('Group not found');
  const { productIds } = req.body;
  await db.transaction((trx) => productGroupItemModel.setProductsForGroup(groupId, productIds, trx));
  res.status(200).json({ productIds });
});

module.exports = {
  listGroups,
  listGroupProducts,
  createGroup,
  updateGroup,
  deleteGroup,
  setGroupProducts,
};
