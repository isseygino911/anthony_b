const db = require('../config/db');
const productModel = require('../models/product.model');
const productImageModel = require('../models/productImage.model');
const categoryModel = require('../models/category.model');
const productGroupItemModel = require('../models/productGroupItem.model');
const productEmbeddingSyncService = require('./productEmbeddingSync.service');
const productSeoSyncService = require('./productSeoSync.service');
const ApiError = require('../utils/apiError');
const { resolveLowStockThreshold } = require('../utils/stockThreshold');
const { signImageUrl } = require('../utils/signedImageUrl');
const { isConfigured: geminiIsConfigured } = require('../config/gemini');

// Fire-and-forget: embedding sync must never block or fail a product save.
// No-ops silently if GEMINI_API_KEY isn't set yet (expected until configured).
function syncEmbeddingNonFatal(product) {
  if (!geminiIsConfigured) return;
  productEmbeddingSyncService.syncProduct(product).catch((err) => {
    console.error(`[product.service] syncProduct(${product.id}) failed`, err);
  });
}

// Fire-and-forget: this only enqueues a 'pending' row (a fast DB write) —
// scripts/seo-geo-worker.js does the actual LLM call out-of-process, so a
// product save is never blocked on it.
function syncSeoNonFatal(product) {
  productSeoSyncService.enqueueProduct(product).catch((err) => {
    console.error(`[product.service] enqueueProduct(${product.id}) failed`, err);
  });
}

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
async function shapeProduct(product, { isAdmin, images, primaryImageUrl, groupIds } = {}) {
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
    base.is_active = Boolean(product.is_active);
  }
  if (images) {
    base.images = await Promise.all(images.map(async (img) => ({ ...img, url: await signImageUrl(img.url) })));
  } else if (primaryImageUrl !== undefined) {
    // List/summary responses only ever fetch the primary image (perf: avoids
    // an N+1 join for every row) — wrap it as a one-element images[] so the
    // client's single `Product.images` contract holds for both list and
    // detail responses instead of exposing a second, list-only field shape.
    base.images = primaryImageUrl
      ? [{ id: 0, url: await signImageUrl(primaryImageUrl), is_primary: true, sort_order: 0 }]
      : [];
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
    // Inactive products only surface when the caller is BOTH an admin AND
    // explicitly asking for the management view (query.includeInactive) —
    // an admin merely browsing the storefront must see exactly what a
    // customer sees, per product requirement: disabled means invisible to
    // everyone in product-list views, admin included.
    includeInactive: isAdmin && query.includeInactive === 'true',
  };

  const [rows, total] = await Promise.all([
    productModel.findAll(filters, { limit: pageSize, offset: (page - 1) * pageSize }),
    productModel.count(filters),
  ]);

  return {
    items: await Promise.all(rows.map((row) => shapeProduct(row, { isAdmin, primaryImageUrl: row.primary_image_url }))),
    total,
    page,
    pageSize,
  };
}

async function getProductDetail(id, { isAdmin, includeInactive }) {
  const product = await productModel.findById(id);
  if (!product) throw ApiError.notFound('Product not found');
  if (!(isAdmin && includeInactive) && !product.is_active) throw ApiError.notFound('Product not found');
  const images = await productImageModel.listByProductId(id);
  const groupIds = isAdmin ? await productGroupItemModel.listGroupIdsForProduct(id) : undefined;
  return shapeProduct(product, { isAdmin, images, groupIds });
}

async function createProduct(data) {
  const product = await productModel.insertProduct(data);
  syncEmbeddingNonFatal(product);
  syncSeoNonFatal(product);
  return shapeProduct(product, { isAdmin: true, images: [] });
}

async function updateProduct(id, data) {
  const existing = await productModel.findById(id);
  if (!existing) throw ApiError.notFound('Product not found');
  const product = await productModel.updateProduct(id, data);
  syncEmbeddingNonFatal(product);
  syncSeoNonFatal(product);
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

async function setProductActive(id, isActive) {
  const existing = await productModel.findById(id);
  if (!existing) throw ApiError.notFound('Product not found');
  await productModel.setActive(id, isActive);
  const updated = await productModel.findById(id);
  return shapeProduct(updated, { isAdmin: true });
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
  setProductActive,
  setGroupsForProduct,
  shapeProduct,
};
