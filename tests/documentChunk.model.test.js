// documentChunk.model CRUD, driven against an in-memory (better-sqlite3)
// Knex instance swapped in for config/db via isolateDb() — same pattern as
// order.service.test.js, since documentChunk.model.js requires config/db at
// module-load time (trx = db default parameter). Schema is local to this
// file (not tests/helpers/testDb.js) since these two tables aren't part of
// that shared helper's existing subset.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the model below
const documentChunkModel = require('../src/models/documentChunk.model');

async function resetSchema() {
  await db.schema.dropTableIfExists('document_chunks');
  await db.schema.dropTableIfExists('documents');

  await db.schema.createTable('documents', (t) => {
    t.increments('id');
    t.string('title');
    t.string('url');
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
}

beforeEach(async () => {
  await resetSchema();
  await db('documents').insert({ id: 1, title: 'Doc 1', url: 'https://example.com/1.pdf', created_at: new Date(), updated_at: new Date() });
});

afterAll(async () => {
  await db.destroy();
});

function chunkRow(overrides = {}) {
  return {
    document_id: 1,
    chunk_index: 0,
    content: 'some extracted text',
    embedding: [0.1, 0.2, 0.3],
    embedding_model: 'text-embedding-004',
    ...overrides,
  };
}

describe('documentChunk.model', () => {
  it('insertChunks bulk-inserts rows with created_at/updated_at set and JSON-encoded embeddings', async () => {
    await documentChunkModel.insertChunks([chunkRow({ chunk_index: 0 }), chunkRow({ chunk_index: 1 })]);

    const rows = await documentChunkModel.listByDocumentId(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].created_at).toBeTruthy();
    expect(rows[0].updated_at).toBeTruthy();
    expect(JSON.parse(rows[0].embedding)).toEqual([0.1, 0.2, 0.3]);
  });

  it('insertChunks is a no-op for an empty array', async () => {
    await documentChunkModel.insertChunks([]);
    expect(await documentChunkModel.listByDocumentId(1)).toHaveLength(0);
  });

  it('listByDocumentId orders by chunk_index ascending', async () => {
    await documentChunkModel.insertChunks([chunkRow({ chunk_index: 2 }), chunkRow({ chunk_index: 0 }), chunkRow({ chunk_index: 1 })]);

    const rows = await documentChunkModel.listByDocumentId(1);
    expect(rows.map((r) => r.chunk_index)).toEqual([0, 1, 2]);
  });

  it("deleteByDocumentId removes only that document's chunks (replace-all support)", async () => {
    await db('documents').insert({ id: 2, title: 'Doc 2', url: 'https://example.com/2.pdf', created_at: new Date(), updated_at: new Date() });
    await documentChunkModel.insertChunks([chunkRow({ document_id: 1 }), chunkRow({ document_id: 2 })]);

    await documentChunkModel.deleteByDocumentId(1);

    expect(await documentChunkModel.listByDocumentId(1)).toHaveLength(0);
    expect(await documentChunkModel.listByDocumentId(2)).toHaveLength(1);
  });

  it('re-indexing (delete then insert) does not duplicate rows', async () => {
    await documentChunkModel.insertChunks([chunkRow({ chunk_index: 0 }), chunkRow({ chunk_index: 1 })]);
    await documentChunkModel.deleteByDocumentId(1);
    await documentChunkModel.insertChunks([chunkRow({ chunk_index: 0 })]);

    expect(await documentChunkModel.listByDocumentId(1)).toHaveLength(1);
  });

  it('listAllWithEmbeddings returns every row across all documents', async () => {
    await db('documents').insert({ id: 2, title: 'Doc 2', url: 'https://example.com/2.pdf', created_at: new Date(), updated_at: new Date() });
    await documentChunkModel.insertChunks([chunkRow({ document_id: 1 }), chunkRow({ document_id: 2 })]);

    expect(await documentChunkModel.listAllWithEmbeddings()).toHaveLength(2);
  });
});
