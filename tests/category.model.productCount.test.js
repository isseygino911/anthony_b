// category.model — countProductsInCategory / countLiveProductsInCategory, the
// guard behind DELETE /admin/categories/:id.
//
// Regression: the guard used to exclude soft-deleted products, but the
// products.category_id foreign key is enforced by MySQL against physical rows
// and knows nothing about deleted_at. A category whose only product was
// soft-deleted therefore passed the guard and then failed the DELETE with a raw
// ER_ROW_IS_REFERENCED_2 (500). The count must see exactly what the FK sees.
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const { isolateDb } = require('./helpers/isolateDb');

const db = isolateDb(); // must happen before requiring the model below
const categoryModel = require('../src/models/category.model');

async function resetSchema() {
  await db.schema.dropTableIfExists('products');
  await db.schema.dropTableIfExists('categories');
  await db.schema.createTable('categories', (t) => {
    t.increments('id');
    t.string('name');
    t.string('slug');
    t.boolean('is_internal').defaultTo(false);
    t.datetime('created_at');
  });
  await db.schema.createTable('products', (t) => {
    t.increments('id');
    t.string('name');
    t.integer('category_id').nullable();
    t.datetime('deleted_at').nullable();
  });
}

beforeEach(resetSchema);
afterAll(() => db.destroy());

async function seedCategory(name = 'Stair Lights') {
  const [id] = await db('categories').insert({
    name,
    slug: name.replace(/ /g, '_'),
    created_at: new Date(),
  });
  return id;
}

function seedProduct(categoryId, { deletedAt = null } = {}) {
  return db('products').insert({
    name: 'Custom Neon Sign',
    category_id: categoryId,
    deleted_at: deletedAt,
  });
}

describe('countProductsInCategory', () => {
  it('counts a soft-deleted product, because the foreign key still does', async () => {
    const categoryId = await seedCategory();
    await seedProduct(categoryId, { deletedAt: new Date() });

    // The exact shape of the reported bug: nothing visible in the admin list,
    // but a row still holding the FK.
    expect(await categoryModel.countProductsInCategory(categoryId)).toBe(1);
    expect(await categoryModel.countLiveProductsInCategory(categoryId)).toBe(0);
  });

  it('counts live products', async () => {
    const categoryId = await seedCategory();
    await seedProduct(categoryId);

    expect(await categoryModel.countProductsInCategory(categoryId)).toBe(1);
    expect(await categoryModel.countLiveProductsInCategory(categoryId)).toBe(1);
  });

  it('counts live and soft-deleted products together', async () => {
    const categoryId = await seedCategory();
    await seedProduct(categoryId);
    await seedProduct(categoryId, { deletedAt: new Date() });

    expect(await categoryModel.countProductsInCategory(categoryId)).toBe(2);
    expect(await categoryModel.countLiveProductsInCategory(categoryId)).toBe(1);
  });

  it('reports zero for a genuinely empty category, so it stays deletable', async () => {
    const categoryId = await seedCategory('Empty');

    expect(await categoryModel.countProductsInCategory(categoryId)).toBe(0);
    expect(await categoryModel.countLiveProductsInCategory(categoryId)).toBe(0);
  });

  it('ignores products belonging to a different category', async () => {
    const categoryId = await seedCategory('Stair Lights');
    const otherId = await seedCategory('Wall Lights');
    await seedProduct(otherId, { deletedAt: new Date() });

    expect(await categoryModel.countProductsInCategory(categoryId)).toBe(0);
  });
});
