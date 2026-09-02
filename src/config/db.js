// Single shared Knex instance (mysql2 client), used app-wide.
const knex = require('knex');
const config = require('./env');

const db = knex({
  client: 'mysql2',
  connection: {
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.name,
    charset: 'utf8mb4',
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  },
  pool: {
    min: 0,
    max: 10,
    // The hosted MySQL runs wait_timeout=20s, so the server hangs up on an idle
    // connection very aggressively. Reaping our own idle connections well
    // inside that window means we close them before the server does, instead of
    // racing it and handing a caller a socket the server has already killed
    // (PROTOCOL_CONNECTION_LOST on the next query). min:0 means idling down to
    // zero costs nothing — connections are re-established on demand.
    idleTimeoutMillis: 10000,
    reapIntervalMillis: 2000,
    acquireTimeoutMillis: 15000,
    createTimeoutMillis: 15000,
  },
});

module.exports = db;
