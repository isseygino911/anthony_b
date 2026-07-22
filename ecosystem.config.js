// PM2 process definition for the SEO/GEO worker only.
// This repo (server/) is standalone — the client is a separate repo, built
// and served as static assets by Caddy (see Caddyfile) on the same VPS. It
// has no PM2 entry here.
//
// The main Express API server (src/server.js) is Docker-managed (see
// Dockerfile / docker-compose.yml) and is NOT defined here.
//
// scripts/seo-geo-worker.js calls Gemini directly (GEMINI_API_KEY) — no CLI
// subprocess, no OAuth session, so it has no bare-metal-only requirement
// anymore and could just as easily run as a Docker Compose service instead
// of under PM2. This file is kept for whichever deploy target is chosen.
//
// scripts/seo-geo-worker.js loads this repo's own `.env` itself via dotenv
// (path resolved relative to that file, not to PM2's cwd), so this
// ecosystem file does not need `env_file` or a duplicated env block — it
// only sets NODE_ENV, which the app reads to decide production-only
// behavior.
module.exports = {
  apps: [
    {
      // Polls product_seo for products queued by product.service.js and
      // calls Gemini to generate SEO/GEO content — see
      // scripts/seo-geo-worker.js. Requires GEMINI_API_KEY in .env.
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
