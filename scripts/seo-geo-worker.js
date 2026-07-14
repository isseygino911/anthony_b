/**
 * Polls product_seo for 'pending' rows (queued by productSeoSync.service.js
 * whenever an admin creates/updates a product) and, for each, invokes the
 * seo-geo-agent subagent headlessly via the Claude Code CLI to generate
 * SEO metadata + GEO content + JSON-LD schema markup, then persists the
 * Result Packet back onto the row.
 *
 * Runs as its own long-lived PM2 process (see ecosystem.config.js) — kept
 * separate from the API server so a slow/stuck LLM call never affects
 * request latency. See seo-geo-agent-guide.md for the overall design.
 *
 * Usage: node scripts/seo-geo-worker.js
 */
const { execFile } = require('child_process');
const db = require('../src/config/db');
const config = require('../src/config/env');
const productModel = require('../src/models/product.model');
const categoryModel = require('../src/models/category.model');
const productImageModel = require('../src/models/productImage.model');
const productSeoModel = require('../src/models/productSeo.model');

const POLL_INTERVAL_MS = Number(process.env.SEO_WORKER_POLL_INTERVAL_MS) || 20000;
const BATCH_SIZE = Number(process.env.SEO_WORKER_BATCH_SIZE) || 3;
const TIMEOUT_MS = Number(process.env.SEO_WORKER_TIMEOUT_MS) || 300000;
const CLAUDE_BIN = process.env.SEO_WORKER_CLAUDE_BIN || 'claude';

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
    availability: Number(product.stock_quantity) > 0 ? 'InStock' : 'OutOfStock',
    canonical_url: `${config.clientOrigin}/product/${product.id}`,
    image_url: primaryImage ? primaryImage.url : null,
    attributes: {
      sku: product.sku,
      tags: parseTags(product.tags),
    },
  };
}

// The top-level `claude -p` invocation is a general-purpose agent that
// delegates to seo-geo-agent as a subagent — by default it summarizes the
// subagent's result in prose rather than passing it through. The explicit
// "your entire response must be ONLY that exact JSON" instruction forces
// raw passthrough (verified manually; still wraps in ```json fences
// sometimes, hence extractJson() below).
function buildPrompt(taskPacket) {
  return (
    `Use the seo-geo-agent to process this product: ${JSON.stringify(taskPacket)}\n\n` +
    'After the agent returns its Result Packet, your entire response must be ONLY that exact JSON object, ' +
    'verbatim, with no markdown code fences, no explanation, and no additional commentary before or after it.'
  );
}

function extractJson(text) {
  let t = text.trim();
  const fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) t = fenced[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in agent output');
  }
  return JSON.parse(t.slice(start, end + 1));
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    execFile(
      CLAUDE_BIN,
      ['-p', prompt, '--output-format', 'json'],
      { timeout: TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`claude CLI failed: ${err.message}${stderr ? ` | stderr: ${stderr.slice(0, 500)}` : ''}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
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
  const prompt = buildPrompt(taskPacket);

  const stdout = await runClaude(prompt);
  const envelope = JSON.parse(stdout);
  if (envelope.is_error) {
    throw new Error(`agent run returned an error: ${JSON.stringify(envelope).slice(0, 500)}`);
  }

  const resultPacket = extractJson(envelope.result);
  if (!resultPacket.status || !resultPacket.seo || !resultPacket.geo) {
    throw new Error(`Result Packet missing required fields: ${JSON.stringify(resultPacket).slice(0, 500)}`);
  }

  await productSeoModel.saveResult({
    productId: row.product_id,
    status: resultPacket.status === 'ready' ? 'ready' : 'needs_review',
    seo: resultPacket.seo,
    geo: resultPacket.geo,
    schemaMarkup: resultPacket.schema_markup,
    audit: resultPacket.audit,
    flags: resultPacket.flags,
  });

  console.log(`[seo-geo-worker] product ${row.product_id} -> ${resultPacket.status}`);
}

async function tick() {
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

  console.log(
    `[seo-geo-worker] started (poll every ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE}, claude bin "${CLAUDE_BIN}")`
  );
  loop();
}

module.exports = { processRow, tick };
