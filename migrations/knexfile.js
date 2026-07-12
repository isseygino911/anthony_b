// Knex configuration. Reads DB connection info from the root .env
// (architecture.md §3: migrations/ is a top-level folder, root .env is the
// single source of DB credentials for both this tooling and server/config/db.js).
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const path = require('path');
const { FsMigrations } = require('knex/lib/migrations/migrate/sources/fs-migrations');

// architecture.md §3 puts knexfile.js in the same flat migrations/ directory
// as the numbered migration files. Knex's default FsMigrations loader picks
// up every *.js file in that directory as a "migration" (it has no built-in
// name filter), which would otherwise make it try (and fail) to run
// knexfile.js itself as a migration. This subclass excludes knexfile.js only.
class ProjectMigrationSource extends FsMigrations {
  async getMigrations(loadExtensions) {
    const migrations = await super.getMigrations(loadExtensions);
    return migrations.filter(
      (m) => path.basename(this.getMigrationName(m)) !== 'knexfile.js'
    );
  }
}

/** @type { import("knex").Knex.Config } */
const development = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  },
  pool: { min: 0, max: 10 },
  migrations: {
    migrationSource: new ProjectMigrationSource(__dirname, false, ['.js']),
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: `${__dirname}/seeds`,
  },
};

module.exports = {
  development,
  // Same connection shape reused for now; a real prod config (e.g. SSL,
  // different pool sizing) can be added here when a prod env is provisioned.
  production: development,
};
