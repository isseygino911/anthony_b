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

  // Counts soft-deleted products too, because the FK does. Those are invisible
  // in the admin list, so say so explicitly rather than claiming the category
  // has products the admin can plainly see it does not.
  const productCount = await categoryModel.countProductsInCategory(id);
  if (productCount > 0) {
    const liveCount = await categoryModel.countLiveProductsInCategory(id);
    throw ApiError.conflict(
      liveCount > 0
        ? 'Category still has products assigned to it'
        : 'Category still has deleted products assigned to it. Reassign them to another category before deleting it.'
    );
  }

  await categoryModel.deleteCategory(id);
  res.status(204).end();
});

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
