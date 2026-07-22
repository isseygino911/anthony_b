// customNeonDesign.model — listPurgeCandidates / purgeImages, the DB half of
// scripts/neon-design-cleanup.js. Confirms: only designs never confirmed
// into an order (product_id null) and past the retention cutoff are
// candidates; purgeImages clears image URLs but keeps every other field
// (the row is a permanent audit record of who generated what, per product
// decision — only image bytes get purged, never the row).
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the model below
const customNeonDesignModel = require('../src/models/customNeonDesign.model');

async function resetSchema() {
  await db.schema.dropTableIfExists('custom_neon_designs');
  await db.schema.createTable('custom_neon_designs', (t) => {
    t.increments('id');
    t.integer('user_id').nullable();
    t.string('session_id').nullable();
    t.string('design_type');
    t.json('input_payload');
    t.string('size').nullable();
    t.string('neon_color').nullable();
    t.decimal('price', 10, 2).nullable();
    t.string('status').defaultTo('pending');
    t.integer('attempts').defaultTo(0);
    t.text('last_error').nullable();
    t.string('generated_image_url').nullable();
    t.integer('product_id').nullable();
    t.text('admin_notes').nullable();
    t.datetime('images_purged_at').nullable();
    t.datetime('created_at');
    t.datetime('updated_at');
  });
}

beforeEach(resetSchema);
afterAll(() => db.destroy());

async function seed(overrides = {}) {
  const now = new Date();
  const [id] = await db('custom_neon_designs').insert({
    user_id: 1,
    design_type: 'upload',
    input_payload: JSON.stringify({ sourceImageUrl: 'https://bucket.s3.us-east-1.amazonaws.com/custom-neon/source/a.png' }),
    status: 'ready',
    generated_image_url: 'https://bucket.s3.us-east-1.amazonaws.com/custom-neon/generated/a.png',
    created_at: now,
    updated_at: now,
    ...overrides,
  });
  return id;
}

const OLD = new Date(Date.now() - 72 * 60 * 60 * 1000); // 72h ago
const RECENT = new Date(Date.now() - 1 * 60 * 60 * 1000); // 1h ago
const CUTOFF = new Date(Date.now() - 48 * 60 * 60 * 1000); // 48h retention window

describe('customNeonDesign.model.listPurgeCandidates', () => {
  it('includes an old, unconfirmed design', async () => {
    const id = await seed({ created_at: OLD });
    const rows = await customNeonDesignModel.listPurgeCandidates(CUTOFF);
    expect(rows.map((r) => r.id)).toContain(id);
  });

  it('excludes a design confirmed into an order (product_id set), regardless of age', async () => {
    await seed({ created_at: OLD, product_id: 42 });
    const rows = await customNeonDesignModel.listPurgeCandidates(CUTOFF);
    expect(rows).toHaveLength(0);
  });

  it('excludes a design still within the retention window', async () => {
    await seed({ created_at: RECENT });
    const rows = await customNeonDesignModel.listPurgeCandidates(CUTOFF);
    expect(rows).toHaveLength(0);
  });

  it('excludes a design whose images were already purged', async () => {
    await seed({ created_at: OLD, images_purged_at: new Date() });
    const rows = await customNeonDesignModel.listPurgeCandidates(CUTOFF);
    expect(rows).toHaveLength(0);
  });
});

describe('customNeonDesign.model.purgeImages', () => {
  it('clears generated_image_url and stamps images_purged_at, but keeps the row and non-image fields', async () => {
    const id = await seed({
      created_at: OLD,
      design_type: 'text',
      neon_color: 'blue',
      size: 'large',
      input_payload: JSON.stringify({ text: 'Layla', fontFamily: 'Pacifico', renderedImageUrl: 'https://bucket.s3.us-east-1.amazonaws.com/x.png' }),
    });

    await customNeonDesignModel.purgeImages(id, { text: 'Layla', fontFamily: 'Pacifico' });

    const row = await customNeonDesignModel.findById(id);
    expect(row.generated_image_url).toBeNull();
    expect(row.images_purged_at).not.toBeNull();
    expect(JSON.parse(row.input_payload)).toEqual({ text: 'Layla', fontFamily: 'Pacifico' });
    // Audit fields survive the purge untouched.
    expect(row.design_type).toBe('text');
    expect(row.neon_color).toBe('blue');
    expect(row.size).toBe('large');
    expect(row.user_id).toBe(1);
  });
});
