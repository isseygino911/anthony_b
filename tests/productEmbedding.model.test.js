// productEmbedding.model CRUD, driven against an in-memory (better-sqlite3)
// Knex instance swapped in for config/db via isolateDb() — same pattern as
// documentChunk.model.test.js. Schema is local to this file (not
// tests/helpers/testDb.js) since product_embeddings isn't part of that
// shared helper's existing subset.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the model below
const productEmbeddingModel = require('../src/models/productEmbedding.model');

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
  await resetSchema();
  await db('products').insert({ id: 1, name: 'Widget' });
});

afterAll(async () => {
  await db.destroy();
});

describe('productEmbedding.model', () => {
  it('findByProductId returns undefined when no row exists', async () => {
    expect(await productEmbeddingModel.findByProductId(1)).toBeUndefined();
  });

  it('upsertForProduct inserts a new row when none exists', async () => {
    const row = await productEmbeddingModel.upsertForProduct({
      productId: 1,
      embedding: [0.1, 0.2],
      model: 'text-embedding-004',
      sourceHash: 'hash-a',
    });

    expect(row.product_id).toBe(1);
    expect(row.source_hash).toBe('hash-a');
    expect(JSON.parse(row.embedding)).toEqual([0.1, 0.2]);
  });

  it('upsertForProduct updates the existing row in place rather than duplicating (unique product_id)', async () => {
    await productEmbeddingModel.upsertForProduct({
      productId: 1,
      embedding: [0.1, 0.2],
      model: 'text-embedding-004',
      sourceHash: 'hash-a',
    });
    await productEmbeddingModel.upsertForProduct({
      productId: 1,
      embedding: [0.9, 0.9],
      model: 'text-embedding-004',
      sourceHash: 'hash-b',
    });

    const rows = await db('product_embeddings').where({ product_id: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0].source_hash).toBe('hash-b');
    expect(JSON.parse(rows[0].embedding)).toEqual([0.9, 0.9]);
  });

  it('listAllWithEmbeddings returns every row', async () => {
    await db('products').insert({ id: 2, name: 'Gadget' });
    await productEmbeddingModel.upsertForProduct({ productId: 1, embedding: [0.1], model: 'm', sourceHash: 'h1' });
    await productEmbeddingModel.upsertForProduct({ productId: 2, embedding: [0.2], model: 'm', sourceHash: 'h2' });

    expect(await productEmbeddingModel.listAllWithEmbeddings()).toHaveLength(2);
  });
});
