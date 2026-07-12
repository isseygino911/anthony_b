const db = require('../config/db');

const TABLE = 'product_groups';

function listGroups(trx = db) {
  return trx(TABLE).select('*').orderBy('name', 'asc');
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

async function insertGroup(data, trx = db) {
  const [id] = await trx(TABLE).insert({
    name: data.name,
    description: data.description ?? null,
    created_at: new Date(),
  });
  return findById(id, trx);
}

async function updateGroup(id, data, trx = db) {
  const patch = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  await trx(TABLE).where({ id }).update(patch);
  return findById(id, trx);
}

function deleteGroup(id, trx = db) {
  return trx(TABLE).where({ id }).del();
}

module.exports = { listGroups, findById, insertGroup, updateGroup, deleteGroup };
