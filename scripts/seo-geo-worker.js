/**
 * Polls product_seo for 'pending' rows (queued by productSeoSync.service.js
 * whenever an admin creates/updates a product) and, for each, calls Gemini
 * directly to generate SEO metadata + GEO content, then assembles JSON-LD
 * schema markup from known product data and persists the result.
 *
 * No CLI subprocess, no OAuth session — just GEMINI_API_KEY (already used
 * elsewhere in this app for embeddings/the assistant), so this runs fine
 * headless: Docker, CI, a plain background process, whatever.
 *
 * Runs as its own long-lived process, separate from the API server, so a
 * slow/stuck LLM call never affects request latency.
 *
 * Usage: node scripts/seo-geo-worker.js
 */
const db = require('../src/config/db');
const config = require('../src/config/env');
const { genAI, isConfigured: geminiConfigured } = require('../src/config/gemini');
const seoGeoPromptService = require('../src/services/seoGeoPrompt.service');
const productModel = require('../src/models/product.model');
const categoryModel = require('../src/models/category.model');
const productImageModel = require('../src/models/productImage.model');
const productSeoModel = require('../src/models/productSeo.model');

const POLL_INTERVAL_MS = Number(process.env.SEO_WORKER_POLL_INTERVAL_MS) || 20000;
const BATCH_SIZE = Number(process.env.SEO_WORKER_BATCH_SIZE) || 3;

function parseTags(tags) {
  if (!tags) return [];
  return typeof tags === 'string' ? JSON.parse(tags) : tags;
}

function buildTaskPacket(product, category, primaryImage) {
  return {
    product_id: product.id,
    name: product.name,
    description: product.description ?? '',
    category: category ? category.name : null,
    price: Number(product.price).toFixed(2),
    price_currency: 'USD', // the storefront hard-codes USD formatting (client/src/lib/utils.ts) — no multi-currency support exists
    availability: Number(product.stock_quantity) > 0 ? 'InStock' : 'OutOfStock',
    canonical_url: `${config.clientOrigin}/product/${product.id}`,
    image_url: primaryImage ? primaryImage.url : null,
    attributes: {
      sku: product.sku,
      tags: parseTags(product.tags),
    },
  };
}

// price/currency/availability/image/url are already known exactly from the
// task packet — no reason to make the model guess or flag them as "needs
// manual verification". Only brand/item_condition come from the model.
function buildSchemaMarkup(product, taskPacket, modelFields) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || null,
    category: taskPacket.category,
    mpn: product.sku,
    brand: { '@type': 'Brand', name: modelFields.brand },
    image: taskPacket.image_url,
    offers: {
      '@type': 'Offer',
      price: taskPacket.price,
      priceCurrency: taskPacket.price_currency,
      availability: `https://schema.org/${taskPacket.availability}`,
      url: taskPacket.canonical_url,
      itemCondition: `https://schema.org/${modelFields.item_condition}`,
    },
    aggregateRating: null,
  };
}

async function processRow(row) {
  const product = await productModel.findByIdIncludingDeleted(row.product_id);
  if (!product) {
    // Product was deleted after being enqueued — nothing to generate for.
    await productSeoModel.saveResult({
      productId: row.product_id,
      status: 'failed',
      seo: null,
      geo: null,
      schemaMarkup: null,
      audit: null,
      flags: ['product no longer exists'],
    });
    return;
  }

  await productSeoModel.markProcessing(row.product_id);

  const category = product.category_id ? await categoryModel.findById(product.category_id) : null;
  const images = await productImageModel.listByProductId(product.id);
  const primaryImage = images.find((img) => img.is_primary) || images[0] || null;
  const taskPacket = buildTaskPacket(product, category, primaryImage);

  const request = seoGeoPromptService.buildRequest(taskPacket);
  const response = await genAI.models.generateContent(request);
  const resultPacket = JSON.parse(response.text || '');
  if (!resultPacket.status || !resultPacket.seo || !resultPacket.geo) {
    throw new Error(`Gemini response missing required fields: ${JSON.stringify(resultPacket).slice(0, 500)}`);
  }

  const schemaMarkup = buildSchemaMarkup(product, taskPacket, resultPacket);

  await productSeoModel.saveResult({
    productId: row.product_id,
    status: resultPacket.status === 'ready' ? 'ready' : 'needs_review',
    seo: resultPacket.seo,
    geo: resultPacket.geo,
    schemaMarkup,
    audit: resultPacket.audit,
    flags: resultPacket.flags,
  });

  console.log(`[seo-geo-worker] product ${row.product_id} -> ${resultPacket.status}`);
}

async function tick() {
  if (!geminiConfigured) {
    console.error('[seo-geo-worker] GEMINI_API_KEY not set — skipping tick');
    return;
  }
  const pending = await productSeoModel.listPending(BATCH_SIZE);
  // eslint-disable-next-line no-restricted-syntax
  for (const row of pending) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await processRow(row);
    } catch (err) {
      console.error(`[seo-geo-worker] product ${row.product_id} failed`, err);
      // eslint-disable-next-line no-await-in-loop
      await productSeoModel.markFailed(row.product_id, err.message || String(err));
    }
  }
}

let stopped = false;
async function loop() {
  if (stopped) return;
  try {
    await tick();
  } catch (err) {
    console.error('[seo-geo-worker] tick failed', err);
  }
  if (!stopped) setTimeout(loop, POLL_INTERVAL_MS);
}

function shutdown() {
  stopped = true;
  db.destroy().finally(() => process.exit(0));
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[seo-geo-worker] started (poll every ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}, model: Gemini)`);
  loop();
}

module.exports = { processRow, tick };
