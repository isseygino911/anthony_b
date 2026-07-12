// Path 3/4: low-stock threshold trigger — architecture.md §7.2.
//
// checkAndNotifyLowStock(product, oldQuantity, newQuantity, trx) takes its
// transaction as an explicit argument (like cart.service's merge function),
// so this suite drives it against a real in-memory (better-sqlite3) Knex
// instance — no db mocking needed, live remote MySQL is never touched.
// (order.service.test.js separately covers the same trigger wired into the
// full createOrder transaction, as an integration-level check.)
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createTestDb } from './helpers/testDb';

const notificationService = require('../src/services/notification.service');

let db;

beforeEach(async () => {
  db = await createTestDb();
});

afterAll(async () => {
  if (db) await db.destroy();
});

function product(overrides = {}) {
  return { id: 1, name: 'Widget', low_stock_threshold: null, ...overrides };
}

describe('notification.service.checkAndNotifyLowStock', () => {
  it('inserts exactly one notification when this order crosses the threshold (old > threshold >= new)', async () => {
    await db.transaction((trx) =>
      notificationService.checkAndNotifyLowStock(product({ low_stock_threshold: 5 }), 7, 4, trx)
    );

    const rows = await db('notifications').select('*');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'low_stock', product_id: 1 });
    expect(rows[0].message).toContain('4 remaining');
  });

  it('does not notify when the new quantity is still above the threshold', async () => {
    await db.transaction((trx) =>
      notificationService.checkAndNotifyLowStock(product({ low_stock_threshold: 5 }), 20, 19, trx)
    );

    expect(await db('notifications').select('*')).toHaveLength(0);
  });

  it('does not notify when stock was already at/below the threshold before this order (not the crossing order)', async () => {
    await db.transaction((trx) =>
      notificationService.checkAndNotifyLowStock(product({ low_stock_threshold: 5 }), 5, 4, trx)
    );

    expect(await db('notifications').select('*')).toHaveLength(0); // oldQuantity 5 is not > threshold 5
  });

  it('fires exactly at the boundary: newQuantity === threshold triggers, oldQuantity === threshold does not', async () => {
    await db.transaction((trx) =>
      notificationService.checkAndNotifyLowStock(product({ low_stock_threshold: 5 }), 6, 5, trx)
    );
    expect(await db('notifications').select('*')).toHaveLength(1);
  });

  it('falls back to the global DEFAULT_LOW_STOCK_THRESHOLD when the product has no override (null)', async () => {
    // config/env.js resolves DEFAULT_LOW_STOCK_THRESHOLD=5 from the repo .env in this test run.
    await db.transaction((trx) =>
      notificationService.checkAndNotifyLowStock(product({ low_stock_threshold: null }), 6, 5, trx)
    );
    expect(await db('notifications').select('*')).toHaveLength(1);

    await db('notifications').del();
    await db.transaction((trx) =>
      notificationService.checkAndNotifyLowStock(product({ low_stock_threshold: null }), 10, 9, trx)
    );
    expect(await db('notifications').select('*')).toHaveLength(0); // 9 still above the global default of 5
  });

  it('a per-product override takes precedence over the global default even when stricter', async () => {
    // Global default is 5; this product's own threshold (2) means 4 remaining does NOT count as low yet.
    await db.transaction((trx) =>
      notificationService.checkAndNotifyLowStock(product({ low_stock_threshold: 2 }), 5, 4, trx)
    );
    expect(await db('notifications').select('*')).toHaveLength(0);
  });
});
