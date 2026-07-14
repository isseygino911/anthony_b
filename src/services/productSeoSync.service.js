// enqueueProduct(product): hash-gated queue insert on product create/update
// — an unchanged name/description/category/price/tags skips re-queuing
// entirely. The actual SEO/GEO generation happens out-of-process in
// scripts/seo-geo-worker.js, which polls product_seo for 'pending' rows.
const crypto = require('crypto');
const productSeoModel = require('../models/productSeo.model');

function parseTags(tags) {
  if (!tags) return [];
  return typeof tags === 'string' ? JSON.parse(tags) : tags;
}

function computeSourceHash(product) {
  const raw = [
    product.name,
    product.description ?? '',
    product.category_id,
    product.price,
    JSON.stringify(parseTags(product.tags)),
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function enqueueProduct(product) {
  const sourceHash = computeSourceHash(product);
  return productSeoModel.enqueue({ productId: product.id, sourceHash });
}

module.exports = { enqueueProduct, computeSourceHash };
