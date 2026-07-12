const db = require('../config/db');

const TABLE = 'site_theme';
const ROW_ID = 1;

function getRow(trx = db) {
  return trx(TABLE).where({ id: ROW_ID }).first();
}

async function upsertRow(data, trx = db) {
  const existing = await getRow(trx);
  const patch = { ...data, updated_at: new Date() };
  if (existing) {
    await trx(TABLE).where({ id: ROW_ID }).update(patch);
  } else {
    await trx(TABLE).insert({ id: ROW_ID, ...patch });
  }
  return getRow(trx);
}

module.exports = { getRow, upsertRow, ROW_ID };
