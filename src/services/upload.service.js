const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const db = require('../config/db');
const { s3Client, bucket, region, isConfigured } = require('../config/s3');
const productImageModel = require('../models/productImage.model');
const ApiError = require('../utils/apiError');

function assertConfigured() {
  if (!isConfigured) {
    throw ApiError.internal('S3 not configured — set AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY/S3_BUCKET_NAME');
  }
}

function objectUrl(key) {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

// Streams a single Multer in-memory file buffer to S3 (no local disk
// persistence, per architecture.md §1).
async function putFile(file, prefix) {
  assertConfigured();
  const key = `${prefix}/${uuidv4()}${path.extname(file.originalname)}`;
  await s3Client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  return objectUrl(key);
}

async function deleteObjectByUrl(url) {
  assertConfigured();
  const key = url.split(`${bucket}.s3.${region}.amazonaws.com/`)[1];
  if (!key) return;
  await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// POST /api/admin/products/:id/images
async function uploadProductImages(productId, files) {
  const urls = await Promise.all(files.map((file) => putFile(file, `products/${productId}`)));
  const existing = await productImageModel.listByProductId(productId);
  const hasPrimary = existing.some((img) => img.is_primary);

  const rows = urls.map((url, index) => ({
    product_id: productId,
    url,
    is_primary: !hasPrimary && index === 0,
    sort_order: existing.length + index,
  }));

  return productImageModel.insertImages(rows);
}

// PATCH /api/admin/products/:id/images/:imageId — unsets prior primary in
// the same transaction (architecture.md §8 "application enforces at most one
// is_primary=1 row per product_id").
async function setPrimaryImage(productId, imageId) {
  const image = await productImageModel.findById(imageId);
  if (!image || image.product_id !== productId) throw ApiError.notFound('Image not found');

  await db.transaction(async (trx) => {
    await productImageModel.unsetPrimaryForProduct(productId, trx);
    await productImageModel.setPrimary(imageId, trx);
  });

  return productImageModel.findById(imageId);
}

// DELETE /api/admin/products/:id/images/:imageId
async function deleteProductImage(productId, imageId) {
  const image = await productImageModel.findById(imageId);
  if (!image || image.product_id !== productId) throw ApiError.notFound('Image not found');
  await deleteObjectByUrl(image.url);
  await productImageModel.deleteById(imageId);
}

// POST /api/admin/theme/logo — uploads only, does not persist into
// site_theme (architecture.md §4.8, "Save theme is the only persisting action").
async function uploadLogo(file) {
  return putFile(file, 'branding');
}

module.exports = { uploadProductImages, setPrimaryImage, deleteProductImage, uploadLogo };
