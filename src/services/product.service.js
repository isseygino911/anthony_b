const db = require('../config/db');
const productModel = require('../models/product.model');
const productImageModel = require('../models/productImage.model');
const categoryModel = require('../models/category.model');
const productGroupItemModel = require('../models/productGroupItem.model');
const ApiError = require('../utils/apiError');
const { resolveLowStockThreshold } = require('../utils/stockThreshold');

function stockStatus(product) {
  if (product.stock_quantity <= 0) return 'out_of_stock';
  if (product.stock_quantity <= resolveLowStockThreshold(product)) return 'low_stock';
  return 'in_stock';
}

function parseTags(tags) {
  if (!tags) return [];
  return typeof tags === 'string' ? JSON.parse(tags) : tags;
}

// Customer-facing responses never include exact stock_quantity (plan §9.1) —
// only admins see the real number.
function shapeProduct(product, { isAdmin, images, primaryImageUrl, groupIds } = {}) {
  const base = {
    id: product.id,
    category_id: product.category_id,
    name: product.name,
    description: product.description,
    price: Number(product.price),
    sku: product.sku,
    tags: parseTags(product.tags),
    is_featured: Boolean(product.is_featured),
    is_bestseller: Boolean(product.is_bestseller),
    is_clearance: Boolean(product.is_clearance),
    stockStatus: stockStatus(product),
  };
  if (isAdmin) {
    base.stock_quantity = product.stock_quantity;
    base.low_stock_threshold = product.low_stock_threshold;
  }
  if (images) {
    base.images = images;
  } else if (primaryImageUrl !== undefined) {
    // List/summary responses only ever fetch the primary image (perf: avoids
    // an N+1 join for every row) — wrap it as a one-element images[] so the
    // client's single `Product.images` contract holds for both list and
    // detail responses instead of exposing a second, list-only field shape.
    base.images = primaryImageUrl ? [{ id: 0, url: primaryImageUrl, is_primary: true, sort_order: 0 }] : [];
  }
  if (groupIds) base.groupIds = groupIds;
  return base;
}

async function resolveCategoryId(categoryParam) {
  if (!categoryParam) return null;
  if (/^\d+$/.test(categoryParam)) return Number(categoryParam);
  const category = await categoryModel.findBySlug(categoryParam);
  return category ? category.id : -1; // -1 never matches -> empty result set
}

async function listProducts(query, { isAdmin }) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  const filters = {
    categoryId: await resolveCategoryId(query.category),
    groupId: query.group ? Number(query.group) : null,
    search: query.search || null,
    tag: query.tag || null,
    sort: query.sort || 'newest',
  };

  const [rows, total] = await Promise.all([
    productModel.findAll(filters, { limit: pageSize, offset: (page - 1) * pageSize }),
    productModel.count(filters),
  ]);

  return {
    items: rows.map((row) => shapeProduct(row, { isAdmin, primaryImageUrl: row.primary_image_url })),
    total,
    page,
    pageSize,
  };
}

async function getProductDetail(id, { isAdmin }) {
  const product = await productModel.findById(id);
  if (!product) throw ApiError.notFound('Product not found');
  const images = await productImageModel.listByProductId(id);
  const groupIds = isAdmin ? await productGroupItemModel.listGroupIdsForProduct(id) : undefined;
  return shapeProduct(product, { isAdmin, images, groupIds });
}

async function createProduct(data) {
  const product = await productModel.insertProduct(data);
  return shapeProduct(product, { isAdmin: true, images: [] });
}

async function updateProduct(id, data) {
  const existing = await productModel.findById(id);
  if (!existing) throw ApiError.notFound('Product not found');
  const product = await productModel.updateProduct(id, data);
  const images = await productImageModel.listByProductId(id);
  return shapeProduct(product, { isAdmin: true, images });
}

async function softDeleteProduct(id) {
  const existing = await productModel.findById(id);
  if (!existing) throw ApiError.notFound('Product not found');
  await productModel.softDeleteProduct(id);
}

async function bulkSoftDelete(ids) {
  await productModel.softDeleteMany(ids);
  return ids;
}

async function setGroupsForProduct(productId, groupIds) {
  const product = await productModel.findById(productId);
  if (!product) throw ApiError.notFound('Product not found');
  await db.transaction((trx) => productGroupItemModel.setGroupsForProduct(productId, groupIds, trx));
  return groupIds;
}

module.exports = {
  listProducts,
  getProductDetail,
  createProduct,
  updateProduct,
  softDeleteProduct,
  bulkSoftDelete,
  setGroupsForProduct,
  shapeProduct,
};
