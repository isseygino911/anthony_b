const favoriteModel = require('../models/favorite.model');
const productService = require('../services/product.service');
const asyncHandler = require('../utils/asyncHandler');

const listFavorites = asyncHandler(async (req, res) => {
  const rows = await favoriteModel.listForUser(req.user.id);
  const items = await Promise.all(
    rows.map((row) =>
      productService.shapeProduct(row, { isAdmin: false, primaryImageUrl: row.primary_image_url })
    )
  );
  res.status(200).json({ items });
});

const addFavorite = asyncHandler(async (req, res) => {
  const productId = Number(req.params.productId);
  const existing = await favoriteModel.exists(req.user.id, productId);
  if (!existing) await favoriteModel.insertFavorite(req.user.id, productId);
  res.status(201).json({ productId });
});

const removeFavorite = asyncHandler(async (req, res) => {
  await favoriteModel.deleteFavorite(req.user.id, Number(req.params.productId));
  res.status(204).end();
});

module.exports = { listFavorites, addFavorite, removeFavorite };
