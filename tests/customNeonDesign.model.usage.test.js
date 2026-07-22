// customNeonDesign.model — listUsageByUser / countUsageByUser, the
// aggregation behind the admin "Custom Neon Usage" tab. Confirms: grouped
// per user_id, counts total designs vs. ones confirmed into an order
// (product_id set), tracks the most recent generation, and excludes rows
// with no user_id (pre-login-requirement anon-session designs can't be
// attributed to anyone).
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

async function seed({ userId, sessionId, productId, createdAt }) {
  await db('custom_neon_designs').insert({
    user_id: userId ?? null,
    session_id: sessionId ?? null,
    design_type: 'text',
    input_payload: JSON.stringify({ text: 'x' }),
    product_id: productId ?? null,
    created_at: createdAt,
    updated_at: createdAt,
  });
}

describe('customNeonDesign.model.listUsageByUser / countUsageByUser', () => {
  it('groups by user_id with a design count, confirmed count, and latest timestamp', async () => {
    await seed({ userId: 1, createdAt: new Date('2026-01-01') });
    await seed({ userId: 1, productId: 5, createdAt: new Date('2026-01-03') });
    await seed({ userId: 1, createdAt: new Date('2026-01-02') });

    const rows = await customNeonDesignModel.listUsageByUser({ limit: 10, offset: 0 });

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].user_id)).toBe(1);
    expect(Number(rows[0].designCount)).toBe(3);
    expect(Number(rows[0].confirmedCount)).toBe(1);
    expect(new Date(rows[0].lastGeneratedAt).toISOString()).toBe(new Date('2026-01-03').toISOString());
  });

  it('keeps separate users as separate rows', async () => {
    await seed({ userId: 1, createdAt: new Date('2026-01-01') });
    await seed({ userId: 2, createdAt: new Date('2026-01-01') });
    await seed({ userId: 2, createdAt: new Date('2026-01-02') });

    const rows = await customNeonDesignModel.listUsageByUser({ limit: 10, offset: 0 });
    const byUser = new Map(rows.map((r) => [Number(r.user_id), r]));

    expect(rows).toHaveLength(2);
    expect(Number(byUser.get(1).designCount)).toBe(1);
    expect(Number(byUser.get(2).designCount)).toBe(2);
  });

  it('excludes designs with no user_id (anon-session rows, pre-login-requirement)', async () => {
    await seed({ sessionId: 'anon-1', createdAt: new Date('2026-01-01') });
    await seed({ userId: 1, createdAt: new Date('2026-01-01') });

    const rows = await customNeonDesignModel.listUsageByUser({ limit: 10, offset: 0 });

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].user_id)).toBe(1);
  });

  it('countUsageByUser counts distinct users, not rows', async () => {
    await seed({ userId: 1, createdAt: new Date() });
    await seed({ userId: 1, createdAt: new Date() });
    await seed({ userId: 2, createdAt: new Date() });

    const { count } = await customNeonDesignModel.countUsageByUser();
    expect(Number(count)).toBe(2);
  });
});
