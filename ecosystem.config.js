// PM2 process definition for the Express API server.
// This repo (server/) is standalone — the client is a separate repo, built
// and served as static assets by Caddy (see Caddyfile) on the same VPS. It
// has no PM2 entry here.
//
// src/config/env.js already loads this repo's own `.env` itself via dotenv
// (path resolved relative to that file, not to PM2's cwd), so this
// ecosystem file does not need `env_file` or a duplicated env block — it
// only sets NODE_ENV, which the app reads to decide production-only
// behavior (e.g. secure cookies).
module.exports = {
  apps: [
    {
      name: 'anthony-ecom-server',
      script: './src/server.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
    },
    {
      // Polls product_seo for products queued by product.service.js and
      // invokes the seo-geo-agent subagent via the Claude Code CLI — see
      // scripts/seo-geo-worker.js. Requires the `claude` CLI installed and
      // authenticated for the OS user PM2 runs as on this box.
      name: 'anthony-ecom-seo-worker',
      script: './scripts/seo-geo-worker.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
