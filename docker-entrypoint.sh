#!/bin/sh
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] running knex migrate:latest..."
  npx knex --knexfile migrations/knexfile.js migrate:latest
fi

exec "$@"
