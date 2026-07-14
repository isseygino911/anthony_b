const db = require('../config/db');

const TABLE = 'documents';

function listAll(trx = db) {
  return trx(TABLE).orderBy('category', 'asc').orderBy('sort_order', 'asc');
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

async function insertDocument(data, trx = db) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    title: data.title,
    category: data.category ?? null,
    url: data.url,
    sort_order: data.sort_order ?? 0,
    created_at: now,
    updated_at: now,
  });
  return findById(id, trx);
}

async function updateDocument(id, data, trx = db) {
  const patch = { updated_at: new Date() };
  const fields = ['title', 'category', 'sort_order'];
  fields.forEach((field) => {
    if (data[field] !== undefined) patch[field] = data[field];
  });

  await trx(TABLE).where({ id }).update(patch);
  return findById(id, trx);
}

function deleteDocument(id, trx = db) {
  return trx(TABLE).where({ id }).del();
}

module.exports = {
  listAll,
  findById,
  insertDocument,
  updateDocument,
  deleteDocument,
};
