/**
 * One-off data fix: move soft-deleted product 18 ("Custom Neon Sign") off
 * category 6 ("Stair Lights") onto category 4 ("Custom Neon Signs",
 * is_internal=1), where its 11 sibling synthetic Custom Neon products live.
 *
 * Why: the products.category_id foreign key is enforced against physical rows,
 * so a soft-deleted product still pins its category. Product 18 is the only
 * thing blocking DELETE of category 6.
 *
 * Safe to re-run: scoped by {id:18, category_id:6}, so a second run updates 0 rows.
 * Verified beforehand: 0 order_items reference product 18.
 * Rollback: UPDATE products SET category_id = 6 WHERE id = 18;
 *
 * Usage: node scripts/oneoff/reassign-product-18.js
 */
const db = require('../../src/config/db');

(async () => {
  const before = await db('products').where({ id: 18 })
    .select('id', 'name', 'category_id', 'deleted_at').first();

  if (!before) {
    console.error('product 18 not found — nothing to do');
    await db.destroy();
    return;
  }
  console.log('BEFORE:', JSON.stringify(before));

  const updated = await db('products')
    .where({ id: 18, category_id: 6 })
    .update({ category_id: 4 });
  console.log('rows updated:', updated);

  const after = await db('products').where({ id: 18 })
    .select('id', 'name', 'category_id', 'deleted_at').first();
  console.log('AFTER :', JSON.stringify(after));

  const remaining = await db('products').where({ category_id: 6 }).count({ c: '*' }).first();
  console.log('products still referencing category 6:', Number(remaining.c));
  console.log(Number(remaining.c) === 0
    ? '=> category 6 is now deletable'
    : '=> category 6 still blocked');

  await db.destroy();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
