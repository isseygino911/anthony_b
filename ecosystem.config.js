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
    {
      // Polls custom_neon_designs for designs queued by
      // customNeonDesign.service.js and calls Gemini's image model to
      // generate a photorealistic neon-sign preview — see
      // scripts/neon-design-worker.js. Requires GEMINI_API_KEY + AWS S3 env
      // vars in .env.
      name: 'anthony-ecom-neon-worker',
      script: './scripts/neon-design-worker.js',
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
      // One-shot cleanup: deletes S3 images for custom neon designs never
      // confirmed into an order after NEON_DESIGN_RETENTION_HOURS — see
      // scripts/neon-design-cleanup.js. Runs once and exits (cron_restart,
      // not autorestart) rather than staying resident like the two workers
      // above; the DB row itself is never deleted.
      name: 'anthony-ecom-neon-cleanup',
      script: './scripts/neon-design-cleanup.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      autorestart: false,
      cron_restart: '0 * * * *', // hourly; the script itself is a no-op if nothing has aged out yet
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
