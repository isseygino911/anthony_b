// Guarantees that `require('../config/db')` — used at module-load time by
// order.service.js, cart.service.js, and every model file — can NEVER
// resolve to the real Hostinger MySQL connection during tests.
//
// `vi.mock` was tried first and found unreliable here: order.service.js
// (and the models it pulls in) are plain CommonJS files reached via nested
// `require()` calls, and empirically those calls kept resolving to the
// real `config/db.js` (confirmed by an actual query error surfacing the
// live remote schema name) even with `vi.mock('../src/config/db', ...)`
// registered in the same test file. Root cause: Vitest's ESM-oriented
// mock registry doesn't intercept nested CJS `require()` calls once
// they're inside Node's native module loader.
//
// Instead, this pre-populates Node's own `require.cache` for the exact
// resolved path of `config/db.js` with an in-memory better-sqlite3 Knex
// instance *before* any application module has a chance to require the
// real one. Because Node's require cache is keyed by absolute resolved
// path, every subsequent `require('../config/db')` from any file
// (services, models, this test) returns the exact same faked instance —
// no real TCP connection to the remote database is ever attempted.
const Module = require('module');
const path = require('path');
const knexLib = require('knex');

const DB_PATH = require.resolve(path.join(__dirname, '..', '..', 'src', 'config', 'db.js'));

function isolateDb() {
  const fakeDb = knexLib({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  const fakeModule = new Module(DB_PATH, module);
  fakeModule.filename = DB_PATH;
  fakeModule.loaded = true;
  fakeModule.exports = fakeDb;
  require.cache[DB_PATH] = fakeModule;

  return fakeDb;
}

module.exports = { isolateDb, DB_PATH };
