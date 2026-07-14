// productEmbeddingSync.service.syncProduct — hash-gated re-embed logic.
//
// embedding.service.js is the only thing that ever talks to Gemini, so it's
// stubbed out the same way tests/helpers/isolateDb.js stubs config/db.js:
// pre-populating Node's own require.cache for its exact resolved path
// before productEmbeddingSync.service.js (or productEmbedding.model.js) ever
// requires it, so no real network call to Gemini can happen in this suite.
// productEmbeddingModel itself runs against a real in-memory (better-sqlite3)
// Knex instance via isolateDb(), so source_hash comparisons are exercised
// end-to-end against actual persisted rows.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const path = require('path');
const Module = require('module');
const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the model/service below

const EMBEDDING_SERVICE_PATH = require.resolve(
  path.join(__dirname, '..', 'src', 'services', 'embedding.service.js')
);

const embedText = vi.fn(async () => [0.1, 0.2, 0.3]);
const fakeEmbeddingModule = new Module(EMBEDDING_SERVICE_PATH, module);
fakeEmbeddingModule.filename = EMBEDDING_SERVICE_PATH;
fakeEmbeddingModule.loaded = true;
fakeEmbeddingModule.exports = { embedText, embedTexts: vi.fn(async () => []) };
require.cache[EMBEDDING_SERVICE_PATH] = fakeEmbeddingModule;

const productEmbeddingSyncService = require('../src/services/productEmbeddingSync.service');

async function resetSchema() {
  await db.schema.dropTableIfExists('product_embeddings');
  await db.schema.dropTableIfExists('products');

  await db.schema.createTable('products', (t) => {
    t.increments('id');
    t.string('name');
  });

  await db.schema.createTable('product_embeddings', (t) => {
    t.increments('id');
    t.integer('product_id');
    t.json('embedding');
    t.string('embedding_model');
    t.string('source_hash');
    t.datetime('created_at');
    t.datetime('updated_at');
  });
}

beforeEach(async () => {
  embedText.mockClear();
  await resetSchema();
});

afterAll(async () => {
  await db.destroy();
});

function product(overrides = {}) {
  return { id: 1, name: 'LED Strip', description: 'Bright and dimmable', tags: ['led', 'lighting'], ...overrides };
}

describe('productEmbeddingSync.service.syncProduct', () => {
  it('calls embedText and persists a row when the product has no prior embedding', async () => {
    const row = await productEmbeddingSyncService.syncProduct(product());

    expect(embedText).toHaveBeenCalledTimes(1);
    expect(row.product_id).toBe(1);
    expect(row.source_hash).toBeTruthy();
  });

  it('skips the embed call when source_hash is unchanged (product untouched since last sync)', async () => {
    await productEmbeddingSyncService.syncProduct(product());
    embedText.mockClear();

    await productEmbeddingSyncService.syncProduct(product());

    expect(embedText).not.toHaveBeenCalled();
  });

  it('calls embedText again when the product name/description/tags changed', async () => {
    await productEmbeddingSyncService.syncProduct(product());
    embedText.mockClear();

    await productEmbeddingSyncService.syncProduct(product({ description: 'Now with a new dimmer feature' }));

    expect(embedText).toHaveBeenCalledTimes(1);
  });
});
