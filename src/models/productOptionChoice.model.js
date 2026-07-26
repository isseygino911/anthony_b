const db = require('../config/db');

const TABLE = 'product_option_choices';

function listByGroupId(groupId, trx = db) {
  return trx(TABLE).where({ option_group_id: groupId }).orderBy('sort_order', 'asc');
}

function listByGroupIds(groupIds, trx = db) {
  if (!groupIds.length) return Promise.resolve([]);
  return trx(TABLE).whereIn('option_group_id', groupIds).orderBy('sort_order', 'asc');
}

function findByGroupIdAndKey(groupId, key, trx = db) {
  return trx(TABLE).where({ option_group_id: groupId, key }).first();
}

async function insertChoices(groupId, choices, trx) {
  const now = new Date();
  const rows = choices.map((choice) => ({
    option_group_id: groupId,
    key: choice.key,
    label: choice.label,
    price_delta: choice.priceDelta ?? 0,
    extra: choice.extra ? JSON.stringify(choice.extra) : null,
    sort_order: choice.sortOrder ?? 0,
    created_at: now,
    updated_at: now,
  }));
  if (rows.length) await trx(TABLE).insert(rows);
}

module.exports = {
  listByGroupId,
  listByGroupIds,
  findByGroupIdAndKey,
  insertChoices,
};
