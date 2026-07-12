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
    idleTimeoutMillis: 20000,
    acquireTimeoutMillis: 15000,
    createTimeoutMillis: 15000,
  },
});

module.exports = db;
