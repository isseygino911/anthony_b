const db = require('../config/db');

const TABLE = 'categories';

// Excludes is_internal categories (e.g. "Custom Neon Signs", used only to
// hold synthetic one-off products minted by customNeonDesign.service.js) —
// those must never appear in storefront nav or the admin product-form
// category picker.
function listCategories(trx = db) {
  return trx(TABLE).select('*').where('is_internal', false).orderBy('name', 'asc');
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

function findBySlug(slug, trx = db) {
  return trx(TABLE).where({ slug }).first();
}

async function insertCategory(data, trx = db) {
  const [id] = await trx(TABLE).insert({
    name: data.name,
    slug: data.slug,
    created_at: new Date(),
  });
  return findById(id, trx);
}

async function updateCategory(id, data, trx = db) {
  await trx(TABLE).where({ id }).update(data);
  return findById(id, trx);
}

function deleteCategory(id, trx = db) {
  return trx(TABLE).where({ id }).del();
}

// Counts every product row still pointing at the category, soft-deleted ones
// included. The products.category_id foreign key is enforced by MySQL against
// physical rows and knows nothing about deleted_at, so excluding soft-deleted
// products here would clear the guard and then fail the DELETE with a raw
// ER_ROW_IS_REFERENCED_2.
async function countProductsInCategory(categoryId, trx = db) {
  const row = await trx('products')
    .where({ category_id: categoryId })
    .count({ count: '*' })
    .first();
  return Number(row.count);
}

// The subset an admin can actually see in the product list — used only to word
// the delete-conflict message, never as the FK safety check.
async function countLiveProductsInCategory(categoryId, trx = db) {
  const row = await trx('products')
    .where({ category_id: categoryId })
    .whereNull('deleted_at')
    .count({ count: '*' })
    .first();
  return Number(row.count);
}

module.exports = {
  listCategories,
  findById,
  findBySlug,
  insertCategory,
  updateCategory,
  deleteCategory,
  countProductsInCategory,
  countLiveProductsInCategory,
};
