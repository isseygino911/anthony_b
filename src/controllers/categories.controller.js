const categoryModel = require('../models/category.model');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');

const listCategories = asyncHandler(async (req, res) => {
  const items = await categoryModel.listCategories();
  res.status(200).json({ items });
});

const createCategory = asyncHandler(async (req, res) => {
  const { name, slug } = req.body;
  const category = await categoryModel.insertCategory({ name, slug });
  res.status(201).json(category);
});

const updateCategory = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await categoryModel.findById(id);
  if (!existing) throw ApiError.notFound('Category not found');
  const category = await categoryModel.updateCategory(id, req.body);
  res.status(200).json(category);
});

const deleteCategory = asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const existing = await categoryModel.findById(id);
  if (!existing) throw ApiError.notFound('Category not found');

  const productCount = await categoryModel.countProductsInCategory(id);
  if (productCount > 0) {
    throw ApiError.conflict('Category still has products assigned to it');
  }

  await categoryModel.deleteCategory(id);
  res.status(204).end();
});

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
