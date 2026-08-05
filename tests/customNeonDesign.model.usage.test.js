// customNeonDesign.model — listUsageByUser / countUsageByUser, the
// aggregation behind the admin "Custom Neon Usage" tab. Confirms: grouped
// per user_id, counts total designs vs. ones confirmed into an order
// (product_id set), tracks the most recent generation, and folds rows with
// no user_id into a single anonymous bucket (signed-out visitors can
// generate, and dropping them made this tab under-report actual usage).
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

  // Anonymous designs are real usage and must be reported. They collapse
  // into one NULL row rather than one row per anon session, since individual
  // sessions aren't attributable to a person.
  it('folds designs with no user_id into a single anonymous bucket', async () => {
    await seed({ sessionId: 'anon-1', createdAt: new Date('2026-01-01') });
    await seed({ sessionId: 'anon-2', productId: 7, createdAt: new Date('2026-01-02') });
    await seed({ userId: 1, createdAt: new Date('2026-01-01') });

    const rows = await customNeonDesignModel.listUsageByUser({ limit: 10, offset: 0 });
    const anonRow = rows.find((r) => r.user_id === null);

    expect(rows).toHaveLength(2);
    expect(anonRow).toBeDefined();
    expect(Number(anonRow.designCount)).toBe(2);
    expect(Number(anonRow.confirmedCount)).toBe(1);
  });

  it('countUsageByUser counts distinct users, not rows', async () => {
    await seed({ userId: 1, createdAt: new Date() });
    await seed({ userId: 1, createdAt: new Date() });
    await seed({ userId: 2, createdAt: new Date() });

    const { count } = await customNeonDesignModel.countUsageByUser();
    expect(Number(count)).toBe(2);
  });

  // The anonymous bucket is one extra row in listUsageByUser, so the total
  // has to include it or the last page goes missing.
  it('countUsageByUser counts the anonymous bucket as one entry', async () => {
    await seed({ userId: 1, createdAt: new Date() });
    await seed({ sessionId: 'anon-1', createdAt: new Date() });
    await seed({ sessionId: 'anon-2', createdAt: new Date() });

    const { count } = await customNeonDesignModel.countUsageByUser();
    expect(Number(count)).toBe(2);
  });

  it('countUsageByUser omits the anonymous bucket when there are no anon designs', async () => {
    await seed({ userId: 1, createdAt: new Date() });

    const { count } = await customNeonDesignModel.countUsageByUser();
    expect(Number(count)).toBe(1);
  });
});

// Mirrors cartService.mergeAnonCartIntoUser. Without this, someone who
// designs before signing up keeps user_id NULL forever, and listMine —
// which branches on the user half of the identity first — shows them an
// empty "My Designs" page.
describe('customNeonDesign.model.reassignSessionToUser', () => {
  it('claims the anon session designs for the user and clears session_id', async () => {
    await seed({ sessionId: 'anon-1', createdAt: new Date('2026-01-01') });
    await seed({ sessionId: 'anon-1', createdAt: new Date('2026-01-02') });

    await customNeonDesignModel.reassignSessionToUser('anon-1', 7);

    const rows = await db('custom_neon_designs').select('user_id', 'session_id');
    expect(rows).toHaveLength(2);
    rows.forEach((row) => {
      expect(Number(row.user_id)).toBe(7);
      // Keeps the "exactly one of the two" convention belongsToIdentity relies on.
      expect(row.session_id).toBeNull();
    });
  });

  it('leaves other sessions and already-owned designs untouched', async () => {
    await seed({ sessionId: 'anon-1', createdAt: new Date('2026-01-01') });
    await seed({ sessionId: 'anon-2', createdAt: new Date('2026-01-01') });
    // A design already belonging to someone else that happens to carry the
    // same session_id must not be stolen by a later login.
    await seed({ userId: 99, sessionId: 'anon-1', createdAt: new Date('2026-01-01') });

    await customNeonDesignModel.reassignSessionToUser('anon-1', 7);

    const claimed = await db('custom_neon_designs').where({ user_id: 7 });
    const untouched = await db('custom_neon_designs').where({ session_id: 'anon-2' }).first();
    const other = await db('custom_neon_designs').where({ user_id: 99 }).first();

    expect(claimed).toHaveLength(1);
    expect(untouched.user_id).toBeNull();
    expect(other.session_id).toBe('anon-1');
  });
});
