// Path 1/4: cart merge-on-login algorithm — architecture.md §6.
//
// mergeAnonCartIntoUser(sessionId, userId, trx) takes its transaction as an
// explicit argument, so this suite drives it against a real in-memory
// (better-sqlite3) Knex instance seeded with `carts` rows — no mocking of
// `config/db` needed, and the live remote MySQL instance is never touched.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb } from './helpers/testDb';

const cartService = require('../src/services/cart.service');

let db;

beforeEach(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  if (db) await db.destroy();
});

async function seedCart(rows) {
  await db('carts').insert(
    rows.map((row) => ({
      session_id: row.sessionId ?? null,
      user_id: row.userId ?? null,
      product_id: row.productId,
      quantity: row.quantity,
      added_at: new Date(),
    }))
  );
}

async function cartRows() {
  return db('carts').select('*').orderBy('cart_id', 'asc');
}

describe('cart.service.mergeAnonCartIntoUser', () => {
  it('is a no-op when no anon_session_id cookie is present (sessionId undefined)', async () => {
    await seedCart([{ userId: 1, productId: 10, quantity: 2 }]);

    await db.transaction((trx) => cartService.mergeAnonCartIntoUser(undefined, 1, trx));

    const rows = await cartRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 1, product_id: 10, quantity: 2 });
  });

  it('is idempotent when the anon cart is already empty (sessionId present, no rows)', async () => {
    await seedCart([{ userId: 1, productId: 10, quantity: 2 }]);

    await db.transaction((trx) => cartService.mergeAnonCartIntoUser('anon-session-1', 1, trx));

    const rows = await cartRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 1, session_id: null, product_id: 10, quantity: 2 });
  });

  it('reassigns non-conflicting anon rows to the user (user_id set, session_id nulled) rather than copying', async () => {
    await seedCart([{ sessionId: 'anon-1', productId: 20, quantity: 3 }]);

    await db.transaction((trx) => cartService.mergeAnonCartIntoUser('anon-1', 5, trx));

    const rows = await cartRows();
    expect(rows).toHaveLength(1); // reassigned, not duplicated
    expect(rows[0]).toMatchObject({ user_id: 5, session_id: null, product_id: 20, quantity: 3 });
  });

  it('sums quantities when the same product exists in both anon and user carts', async () => {
    await seedCart([
      { userId: 7, productId: 30, quantity: 4 },
      { sessionId: 'anon-2', productId: 30, quantity: 5 },
    ]);

    await db.transaction((trx) => cartService.mergeAnonCartIntoUser('anon-2', 7, trx));

    const rows = await cartRows();
    expect(rows).toHaveLength(1); // anon row deleted, user row updated in place
    expect(rows[0]).toMatchObject({ user_id: 7, product_id: 30, quantity: 9 }); // 4 + 5, summed not averaged/overwritten
  });

  it('handles a mix of conflicting and non-conflicting rows in one merge', async () => {
    await seedCart([
      { userId: 8, productId: 1, quantity: 2 }, // will conflict with anon product 1
      { sessionId: 'anon-3', productId: 1, quantity: 3 }, // conflicts -> summed
      { sessionId: 'anon-3', productId: 2, quantity: 6 }, // no conflict -> reassigned
    ]);

    await db.transaction((trx) => cartService.mergeAnonCartIntoUser('anon-3', 8, trx));

    const rows = await cartRows();
    expect(rows).toHaveLength(2);
    const byProduct = new Map(rows.map((r) => [r.product_id, r]));
    expect(byProduct.get(1)).toMatchObject({ user_id: 8, quantity: 5, session_id: null });
    expect(byProduct.get(2)).toMatchObject({ user_id: 8, quantity: 6, session_id: null });
  });

  it('running merge twice in a row is safe (second call is a no-op, per-login idempotency)', async () => {
    await seedCart([{ sessionId: 'anon-4', productId: 40, quantity: 1 }]);

    await db.transaction((trx) => cartService.mergeAnonCartIntoUser('anon-4', 9, trx));
    await db.transaction((trx) => cartService.mergeAnonCartIntoUser('anon-4', 9, trx));

    const rows = await cartRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: 9, quantity: 1 });
  });
});
