const db = require('../config/db');

const TABLE = 'categories';

function listCategories(trx = db) {
  return trx(TABLE).select('*').orderBy('name', 'asc');
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

async function countProductsInCategory(categoryId, trx = db) {
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
};
