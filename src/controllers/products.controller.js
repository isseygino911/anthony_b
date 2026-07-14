const productService = require('../services/product.service');
const uploadService = require('../services/upload.service');
const productSeoModel = require('../models/productSeo.model');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/apiError');
const { signImageUrl } = require('../utils/signedImageUrl');

// product_seo's JSON columns come back auto-parsed on MySQL but as strings
// on sqlite (tests) — mirrors product.service.js's parseTags() handling.
function parseJsonColumn(value) {
  if (value == null) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function shapeProductSeo(row) {
  if (!row) return null;
  return {
    productId: row.product_id,
    status: row.status,
    attempts: row.attempts,
    seo: parseJsonColumn(row.seo),
    geo: parseJsonColumn(row.geo),
    schemaMarkup: parseJsonColumn(row.schema_markup),
    audit: parseJsonColumn(row.audit),
    flags: parseJsonColumn(row.flags) ?? [],
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

const isAdminReq = (req) => Boolean(req.user && req.user.role === 'admin');

const listProducts = asyncHandler(async (req, res) => {
  const result = await productService.listProducts(req.query, { isAdmin: isAdminReq(req) });
  res.status(200).json(result);
});

const getProduct = asyncHandler(async (req, res) => {
  const product = await productService.getProductDetail(Number(req.params.id), {
    isAdmin: isAdminReq(req),
  });
  res.status(200).json(product);
});

const createProduct = asyncHandler(async (req, res) => {
  const product = await productService.createProduct(req.body);
  res.status(201).json(product);
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await productService.updateProduct(Number(req.params.id), req.body);
  res.status(200).json(product);
});

const deleteProduct = asyncHandler(async (req, res) => {
  await productService.softDeleteProduct(Number(req.params.id));
  res.status(204).end();
});

const bulkDeleteProducts = asyncHandler(async (req, res) => {
  const { ids } = req.body;
  const softDeleted = await productService.bulkSoftDelete(ids);
  res.status(200).json({ softDeleted });
});

const uploadProductImages = asyncHandler(async (req, res) => {
  if (!req.files || !req.files.length) throw ApiError.badRequest('No files uploaded');
  const images = await uploadService.uploadProductImages(Number(req.params.id), req.files);
  const signed = await Promise.all(images.map(async (img) => ({ ...img, url: await signImageUrl(img.url) })));
  res.status(201).json({ images: signed });
});

const setPrimaryImage = asyncHandler(async (req, res) => {
  const image = await uploadService.setPrimaryImage(Number(req.params.id), Number(req.params.imageId));
  res.status(200).json({ ...image, url: await signImageUrl(image.url) });
});

const deleteProductImage = asyncHandler(async (req, res) => {
  await uploadService.deleteProductImage(Number(req.params.id), Number(req.params.imageId));
  res.status(204).end();
});

const setProductGroups = asyncHandler(async (req, res) => {
  const groupIds = await productService.setGroupsForProduct(Number(req.params.id), req.body.groupIds);
  res.status(200).json({ groupIds });
});

const getProductSeo = asyncHandler(async (req, res) => {
  const row = await productSeoModel.findByProductId(Number(req.params.id));
  if (!row) throw ApiError.notFound('No SEO/GEO data for this product yet');
  res.status(200).json(shapeProductSeo(row));
});

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkDeleteProducts,
  uploadProductImages,
  setPrimaryImage,
  deleteProductImage,
  setProductGroups,
  getProductSeo,
};
