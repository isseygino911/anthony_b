const db = require('../config/db');

const TABLE = 'users';
const PUBLIC_COLUMNS = ['id', 'email', 'name', 'role', 'provider', 'created_at'];

function findByEmail(email, trx = db) {
  return trx(TABLE).where({ email }).first();
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

function findByProvider(provider, providerId, trx = db) {
  return trx(TABLE).where({ provider, provider_id: providerId }).first();
}

async function insertUser(data, trx = db) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    email: data.email,
    password_hash: data.passwordHash || null,
    provider: data.provider,
    provider_id: data.providerId || null,
    name: data.name,
    role: data.role || 'customer',
    created_at: now,
    updated_at: now,
  });
  return findById(id, trx);
}

module.exports = { findByEmail, findById, findByProvider, insertUser, PUBLIC_COLUMNS };
