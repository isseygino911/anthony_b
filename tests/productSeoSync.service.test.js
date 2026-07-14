// productSeoSync.service.enqueueProduct — hash-gated queue insert. Unlike
// productEmbeddingSync, there's no external client to stub: enqueueing is
// just a DB write (the actual LLM call happens out-of-process in
// scripts/seo-geo-worker.js), so this only needs the real in-memory schema.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the model/service below

const productSeoSyncService = require('../src/services/productSeoSync.service');
const productSeoModel = require('../src/models/productSeo.model');

async function resetSchema() {
  await db.schema.dropTableIfExists('product_seo');
  await db.schema.dropTableIfExists('products');

  await db.schema.createTable('products', (t) => {
    t.increments('id');
    t.string('name');
  });

  await db.schema.createTable('product_seo', (t) => {
    t.increments('id');
    t.integer('product_id');
    t.string('status');
    t.integer('attempts');
    t.string('source_hash');
    t.json('seo');
    t.json('geo');
    t.json('schema_markup');
    t.json('audit');
    t.json('flags');
    t.text('last_error');
    t.datetime('created_at');
    t.datetime('updated_at');
  });
}

beforeEach(resetSchema);

afterAll(async () => {
  await db.destroy();
});

function product(overrides = {}) {
  return {
    id: 1,
    name: 'LED Strip',
    description: 'Bright and dimmable',
    category_id: 2,
    price: '19.99',
    tags: ['led', 'lighting'],
    ...overrides,
  };
}

describe('productSeoSync.service.enqueueProduct', () => {
  it('inserts a pending row for a never-seen product', async () => {
    const row = await productSeoSyncService.enqueueProduct(product());

    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.source_hash).toBeTruthy();
  });

  it('skips re-queuing when source_hash is unchanged and the row is not failed', async () => {
    await productSeoSyncService.enqueueProduct(product());
    await productSeoModel.saveResult({
      productId: 1,
      status: 'ready',
      seo: { meta_title: 'x' },
      geo: {},
      schemaMarkup: {},
      audit: {},
      flags: [],
    });

    const second = await productSeoSyncService.enqueueProduct(product());

    expect(second.status).toBe('ready'); // untouched — not reset back to pending
  });

  it('re-queues (resets to pending) when product content changed', async () => {
    await productSeoSyncService.enqueueProduct(product());
    await productSeoModel.saveResult({
      productId: 1,
      status: 'ready',
      seo: {},
      geo: {},
      schemaMarkup: {},
      audit: {},
      flags: [],
    });

    const updated = await productSeoSyncService.enqueueProduct(product({ description: 'New dimmer feature' }));

    expect(updated.status).toBe('pending');
    expect(updated.attempts).toBe(0);
  });

  it('re-queues a previously failed row even if content is unchanged', async () => {
    await productSeoSyncService.enqueueProduct(product());
    await productSeoModel.markFailed(1, 'boom');
    await productSeoModel.markFailed(1, 'boom');
    await productSeoModel.markFailed(1, 'boom'); // 3rd attempt -> status 'failed'

    const row = await productSeoModel.findByProductId(1);
    expect(row.status).toBe('failed');

    const requeued = await productSeoSyncService.enqueueProduct(product());
    expect(requeued.status).toBe('pending');
    expect(requeued.attempts).toBe(0);
  });
});
