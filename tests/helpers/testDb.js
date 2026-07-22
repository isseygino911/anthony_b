// Shared in-memory (better-sqlite3) Knex schema/instance builder for
// isolated business-logic tests. Never touches the live Hostinger MySQL
// instance. Schema here is a minimal subset of migrations/*.js — just
// enough columns for the service/model queries under test, not a full
// migration mirror.
const knex = require('knex');

async function applySchema(db) {
  await db.schema.createTable('products', (t) => {
    t.increments('id');
    t.integer('category_id');
    t.string('name');
    t.decimal('price', 10, 2);
    t.integer('stock_quantity');
    t.integer('low_stock_threshold').nullable();
    t.datetime('deleted_at').nullable();
  });

  await db.schema.createTable('product_images', (t) => {
    t.increments('id');
    t.integer('product_id');
    t.string('url');
    t.boolean('is_primary').defaultTo(false);
  });

  await db.schema.createTable('carts', (t) => {
    t.increments('cart_id');
    t.string('session_id').nullable();
    t.integer('user_id').nullable();
    t.integer('product_id');
    t.integer('quantity');
    t.datetime('added_at');
  });

  await db.schema.createTable('orders', (t) => {
    t.increments('id');
    t.integer('user_id');
    t.string('status');
    t.json('shipping_address');
    t.decimal('subtotal', 10, 2);
    t.decimal('adjustment_total', 10, 2).defaultTo(0);
    t.decimal('total', 10, 2);
    t.datetime('created_at');
    t.datetime('updated_at');
  });

  await db.schema.createTable('order_items', (t) => {
    t.increments('id');
    t.integer('order_id');
    t.string('item_type');
    t.integer('product_id').nullable();
    t.string('label');
    t.decimal('unit_price', 10, 2).nullable();
    t.integer('quantity').nullable();
    t.decimal('amount', 10, 2).nullable();
    t.datetime('created_at');
  });

  await db.schema.createTable('order_audit_log', (t) => {
    t.increments('id');
    t.integer('order_id');
    t.integer('actor_user_id');
    t.string('field_changed');
    t.string('old_value').nullable();
    t.string('new_value');
    t.string('reason').nullable();
    t.datetime('created_at');
  });

  await db.schema.createTable('notifications', (t) => {
    t.increments('id');
    t.string('type');
    t.integer('product_id').nullable();
    t.string('message');
    t.boolean('is_read').defaultTo(false);
    t.datetime('created_at');
  });

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

  return db;
}

async function createTestDb() {
  const db = knex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
  return applySchema(db);
}

module.exports = { createTestDb, applySchema };
