// assistant.service.sendMessage — the single most important Stage 2 test:
// proves the hard read-only trust boundary (only IDs that survive a live
// product.service.getProductDetail/document.service.getDocument re-fetch
// ever reach the client or get persisted) and the decline-path short-circuit
// (off-topic messages never reach retrieval/generation).
//
// config/db is isolated the same way order.service.test.js/
// documentChunk.model.test.js do it (real in-memory better-sqlite3, local
// schema). config/gemini, embedding.service, and assistantGuard.service are
// stubbed via require.cache pre-population (same technique as
// productEmbeddingSync.service.test.js), so no real network call to Gemini
// ever happens in this suite.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const path = require('path');
const Module = require('module');
const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring any model/service below

function stubModule(resolvedPath, exports) {
  const fakeModule = new Module(resolvedPath, module);
  fakeModule.filename = resolvedPath;
  fakeModule.loaded = true;
  fakeModule.exports = exports;
  require.cache[resolvedPath] = fakeModule;
  return exports;
}

const GEMINI_CONFIG_PATH = require.resolve(path.join(__dirname, '..', 'src', 'config', 'gemini.js'));
const generateContent = vi.fn();
stubModule(GEMINI_CONFIG_PATH, {
  genAI: { models: { generateContent } },
  isConfigured: true,
  embeddingModel: 'gemini-embedding-001',
  chatModel: 'gemini-2.5-flash',
});

const EMBEDDING_SERVICE_PATH = require.resolve(path.join(__dirname, '..', 'src', 'services', 'embedding.service.js'));
const embedText = vi.fn(async () => [1, 0, 0]);
stubModule(EMBEDDING_SERVICE_PATH, { embedText, embedTexts: vi.fn(async () => []) });

const ASSISTANT_GUARD_PATH = require.resolve(path.join(__dirname, '..', 'src', 'services', 'assistantGuard.service.js'));
const classifyIntent = vi.fn(async () => true);
const declineMessage = vi.fn(() => "I'm here to help you find products — try asking about our catalog!");
stubModule(ASSISTANT_GUARD_PATH, { classifyIntent, declineMessage });

const assistantService = require('../src/services/assistant.service');

async function resetSchema() {
  const tables = [
    'assistant_messages',
    'assistant_conversations',
    'product_embeddings',
    'document_chunks',
    'documents',
    'product_images',
    'products',
  ];
  // eslint-disable-next-line no-restricted-syntax
  for (const table of tables) {
    // eslint-disable-next-line no-await-in-loop
    await db.schema.dropTableIfExists(table);
  }

  await db.schema.createTable('products', (t) => {
    t.increments('id');
    t.integer('category_id');
    t.string('name');
    t.text('description');
    t.decimal('price', 10, 2);
    t.string('sku');
    t.json('tags').nullable();
    t.integer('stock_quantity');
    t.integer('low_stock_threshold').nullable();
    t.boolean('is_featured').defaultTo(false);
    t.boolean('is_bestseller').defaultTo(false);
    t.boolean('is_clearance').defaultTo(false);
    t.boolean('is_active').defaultTo(true);
    t.datetime('deleted_at').nullable();
    t.datetime('created_at');
    t.datetime('updated_at');
  });
  await db.schema.createTable('product_images', (t) => {
    t.increments('id');
    t.integer('product_id');
    t.string('url');
    t.boolean('is_primary').defaultTo(false);
    t.integer('sort_order').defaultTo(0);
    t.datetime('created_at');
  });
  await db.schema.createTable('documents', (t) => {
    t.increments('id');
    t.string('title');
    t.string('category').nullable();
    t.string('url');
    t.integer('sort_order').defaultTo(0);
    t.datetime('created_at');
    t.datetime('updated_at');
  });
  await db.schema.createTable('document_chunks', (t) => {
    t.increments('id');
    t.integer('document_id');
    t.integer('chunk_index');
    t.text('content');
    t.json('embedding');
    t.string('embedding_model');
    t.datetime('created_at');
    t.datetime('updated_at');
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
  await db.schema.createTable('assistant_conversations', (t) => {
    t.increments('id');
    t.integer('user_id').nullable();
    t.string('anon_session_id').nullable();
    t.datetime('created_at');
    t.datetime('updated_at');
  });
  await db.schema.createTable('assistant_messages', (t) => {
    t.increments('id');
    t.integer('conversation_id');
    t.string('role');
    t.text('content');
    t.json('cited_product_ids').nullable();
    t.json('cited_document_ids').nullable();
    t.datetime('created_at');
  });
}

async function seedProduct(overrides = {}) {
  const now = new Date();
  const [id] = await db('products').insert({
    category_id: 1,
    name: 'LED Bedroom Light',
    description: 'A warm dimmable LED fixture.',
    price: 49.99,
    sku: 'LED-BR-1',
    stock_quantity: 20,
    low_stock_threshold: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  });
  return id;
}

beforeEach(async () => {
  await resetSchema();
  generateContent.mockReset();
  embedText.mockClear();
  classifyIntent.mockReset();
  classifyIntent.mockResolvedValue(true);
  declineMessage.mockClear();
});

afterAll(async () => {
  await db.destroy();
});

describe('assistant.service.sendMessage — on-topic path', () => {
  it('resolves only real product IDs through product.service, filtering out nonexistent/soft-deleted ones', async () => {
    const realProductId = await seedProduct();
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        reply: 'This LED bedroom light should work well for you.',
        productIds: [realProductId, 999999], // 999999 does not exist
        documentIds: [],
      }),
    });

    const result = await assistantService.sendMessage({
      message: 'I need an LED light for my bedroom',
      userId: null,
      anonSessionId: 'anon-session-1',
      conversationId: undefined,
    });

    expect(result.reply).toBe('This LED bedroom light should work well for you.');
    expect(result.products).toHaveLength(1);
    expect(result.products[0].id).toBe(realProductId);
    expect(result.documents).toEqual([]);

    // The persisted message must only ever hold resolved (post-filter) IDs.
    const assistantRow = await db('assistant_messages').where({ role: 'assistant' }).first();
    expect(JSON.parse(assistantRow.cited_product_ids)).toEqual([realProductId]);
    expect(JSON.parse(assistantRow.cited_document_ids)).toEqual([]);
  });

  it('persists both the user message and the assistant reply', async () => {
    const realProductId = await seedProduct();
    generateContent.mockResolvedValue({
      text: JSON.stringify({ reply: 'Sure thing.', productIds: [realProductId], documentIds: [] }),
    });

    await assistantService.sendMessage({
      message: 'I need an LED light for my bedroom',
      userId: null,
      anonSessionId: 'anon-session-2',
      conversationId: undefined,
    });

    const rows = await db('assistant_messages').select('role', 'content').orderBy('id', 'asc');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ role: 'user', content: 'I need an LED light for my bedroom' });
    expect(rows[1]).toMatchObject({ role: 'assistant', content: 'Sure thing.' });
  });
});

describe('assistant.service.sendMessage — off-topic decline path', () => {
  it('never calls retrieval/generation when classifyIntent returns false', async () => {
    classifyIntent.mockResolvedValue(false);

    const result = await assistantService.sendMessage({
      message: 'write me a poem about the ocean',
      userId: null,
      anonSessionId: 'anon-session-3',
      conversationId: undefined,
    });

    expect(result.reply).toBe(declineMessage());
    expect(result.products).toEqual([]);
    expect(result.documents).toEqual([]);
    expect(embedText).not.toHaveBeenCalled();
    expect(generateContent).not.toHaveBeenCalled();

    const rows = await db('assistant_messages').select('role').orderBy('id', 'asc');
    expect(rows.map((r) => r.role)).toEqual(['user', 'assistant']);
  });
});
