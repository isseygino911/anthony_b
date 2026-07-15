# Anthony Ecom — API Server

Express MVC REST API for the white-label e-commerce template: products, cart,
checkout, auth (email/password + Google OAuth), orders, and admin endpoints.
Backed by MySQL via Knex.js, with product images/brand assets stored in AWS S3.

This is a standalone repo. It is paired with a separate frontend repo (the
React/Vite storefront + admin panel), which is developed and deployed
independently. In production the two are reverse-proxied together by Caddy
(see `Caddyfile`); in development the frontend's Vite dev server proxies
`/api/*` requests to this server directly, and this server allows that origin
via CORS (`CLIENT_ORIGIN`).

For full technical detail (API contracts, DB schema, security notes,
deployment shape) see [`docs/architecture.md`](./docs/architecture.md). For
QA scope, see [`docs/test-plan.md`](./docs/test-plan.md).

## Prerequisites

- Node.js 18+ and npm 9+.
- No local MySQL install needed — this app is a client to an existing
  **remote** MySQL instance (Hostinger-hosted). You just need connection
  credentials for that instance.
- AWS S3 bucket + credentials (only required to exercise image upload).
- A Google Cloud OAuth app (only required to exercise Google login).

## Setup

```bash
npm install

# Copy the env template and fill in real values (see table below)
cp .env.example .env

# Run migrations against the remote MySQL instance, then seed demo data
npm run migrate
npm run seed
```

The seed creates: 1 category, 3 demo products (with images), 1 default
`site_theme` row, and 1 demo admin user (see `migrations/seeds/`).

## Running the dev server

```bash
npm run dev
```

Starts the Express API on `http://localhost:4002` (via nodemon). Pair it
with the separate frontend repo's `npm run dev` (Vite, default
`http://localhost:5173`), which proxies `/api/*` here.

## Running migrations/seeds

```bash
npm run migrate           # apply all pending migrations
npm run migrate:rollback  # roll back the last migration batch
npm run seed              # run seed scripts
```

These read `DB_*` vars from `.env` via `migrations/knexfile.js`.

## Running tests

```bash
npm test
```

Runs against an isolated in-memory (better-sqlite3) database — never the
live MySQL instance. See `docs/test-plan.md` for full QA scope.

## Environment variables

Copy `.env.example` to `.env` in this directory and fill in real values.
Never commit the real `.env` file.

| Variable | Purpose |
|---|---|
| `NODE_ENV` | `development` / `production` — gates behavior like secure cookies |
| `PORT` | Port the Express server listens on (default `4002`) |
| `DB_HOST` | Remote MySQL host |
| `DB_PORT` | Remote MySQL port |
| `DB_USER` | Remote MySQL username |
| `DB_PASSWORD` | Remote MySQL password |
| `DB_NAME` | Remote MySQL database name |
| `JWT_SECRET` | Signing secret for auth JWTs — generate a real random string |
| `JWT_EXPIRES_IN` | JWT expiry (e.g. `7d`) |
| `GOOGLE_CLIENT_ID` | Google OAuth app client ID (leave blank to disable Google login) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth app client secret |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL the server registers with Google |
| `AWS_ACCESS_KEY_ID` | AWS IAM key for S3 access (leave blank to disable image upload) |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM secret |
| `AWS_REGION` | S3 bucket region |
| `S3_BUCKET_NAME` | S3 bucket for product images and logo |
| `COOKIE_DOMAIN` | Domain scope for auth/session cookies |
| `CLIENT_ORIGIN` | Origin of the separate frontend repo's dev server, used for CORS |
| `CSRF_SECRET` | Signing secret for CSRF double-submit tokens — generate a real random string |
| `DEFAULT_LOW_STOCK_THRESHOLD` | Global fallback low-stock threshold when a product has no per-product override |

## Deploy shape (conceptual — not provisioned)

- `ecosystem.config.js` — PM2 process definition for this Express server
  (`src/server.js` as entrypoint).
- `Caddyfile` — reverse proxy config: routes `/api/*` to the PM2-managed
  Express process, serves the frontend repo's static build for everything
  else with SPA fallback to `index.html`. Assumes this repo and the frontend
  repo are deployed as sibling checkouts on the VPS — see the comment at the
  top of `Caddyfile` for the exact assumed layout and adjust as needed.

Actual VPS provisioning, domain/DNS, and TLS setup are not done by this repo.
