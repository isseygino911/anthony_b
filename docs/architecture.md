# E-Commerce Template — Technical Architecture

Status: source of truth for implementation. This document is derived from
`ecommerce-template-plan.md` (product/behavior spec, final — do not re-litigate
its decisions). Every design choice below either implements a plan decision
directly or fills an implementation gap the plan left open. Where this doc
adds something the plan didn't specify, it's called out as an architecture
decision, not a product decision.

Downstream engineer agents (backend, frontend, database, QA, devops) should
treat this file as authoritative for folder structure, API contracts, and
schema. Do not re-derive these from the plan — implement from here.

---

## 0. Component Overview

| Component | Responsibility |
|---|---|
| `client/` (React SPA) | Renders storefront + admin UI, applies theme CSS variables, calls REST API. No business logic beyond client-side validation mirrors. |
| `server/` (Express API, MVC) | Auth, product/catalog CRUD, cart, orders, theme config, notifications, revenue aggregation. Single source of business logic. |
| MySQL (Hostinger-hosted) | Persistent store for all entities below. Accessed only from `server/` via `mysql2`/Knex — never from the client. |
| AWS S3 | Object storage for product images and brand assets (logo). Server issues upload URLs / proxies uploads; client never talks to S3 directly with long-lived credentials. |
| Caddy + PM2 (deploy target) | Reverse proxy (TLS termination, routing `/api` to Express, static files to client build) and process manager for the Express app. Config files are devops-agent's job, not designed here beyond the shape below. |

Each component has exactly one responsibility. The theme layer (`site_theme` +
CSS variables) is fully separate from the core commerce engine (products,
cart, checkout, auth, orders) per plan §2 — the core engine has zero
knowledge of brand name/colors beyond serving the `site_theme` row.

**Duplication risk called out up front:** the color-palette definitions
(§6.2 of the plan: Ocean, Sunset, Earth, etc. as `{accent, accentSecondary}`
pairs) must live in exactly one shared file consumed by both the admin
theme-picker UI and any server-side validation of `palette_id`. See
§4 (Folder Structure) — `client/src/theme/palettes.ts` is that single
source; the server only stores/validates `palette_id` against a small
constant array mirrored (not re-derived) from the same list — see §7.9.

Similarly, order-total derivation logic (line items + adjustments) must be
computed in exactly one place server-side (`server/services/order.service.js`)
and never recomputed independently by another service or by the client. The
client only ever displays totals the server returns.

---

## 1. Tech Choices (deviations / clarifications only)

| Choice | Reason |
|---|---|
| Knex.js as query builder (not raw `mysql2` calls, not a full ORM like Sequelize/TypeORM) | Plan mandates "no heavy ORM." Knex gives migrations + a query builder without model-layer magic, keeping the MVC `models/` folder as plain functions over Knex, per plan's Express-MVC requirement. |
| `express-session` is NOT used for auth; JWT (httpOnly cookie) is used instead | Avoids a server-side session-store dependency for logged-in auth. Anonymous cart identity (`session_id`) is a separate, simpler UUID-in-cookie mechanism (plan §9.3), unrelated to login sessions — these two concerns are intentionally decoupled. |
| `csurf`-style double-submit CSRF token (custom middleware, since `csurf` is deprecated) | Plan requires CSRF on cart/checkout/admin mutations; double-submit-cookie pattern works statelessly alongside the JWT cookie approach. |
| Multer + streaming to S3 (`@aws-sdk/client-s3`) for image upload, no local disk persistence | Plan requires S3-backed image storage; avoids an intermediate local-disk state that would need cleanup. |
| Recharts on the client for revenue dashboard | Already specified by plan §5. |

Everything else defaults to the plan's stack: React + shadcn/ui + Tailwind,
Express MVC, MySQL, Helmet, rate limiting, Google OAuth + email/password,
Stripe deferred, Caddy + PM2.

---

## 2. Data Flow (representative sequences)

**Anonymous browsing → add to cart → login → checkout:**
1. Client requests `GET /api/theme` on first paint → sets CSS vars, resolves mode via cookie/default_mode/prefers-color-scheme (§5).
2. First visit with no `anon_session_id` cookie → server sets one (httpOnly, long-lived) on first cart-touching request.
3. `POST /api/cart/items` writes a row keyed by `session_id`, `user_id = NULL`.
4. User logs in (`POST /api/auth/login` or Google OAuth callback) → server runs cart-merge (§6) inside the same transaction as issuing the auth cookie.
5. `POST /api/orders` (checkout) reads the user's cart rows, snapshots them into `order_items`, computes total (§7 order model), creates `orders` row with `status = 'pending_payment'`, clears the cart.
6. Client shows confirmation page reading `GET /api/orders/:id`.

**Admin edits an order:**
1. `PATCH /api/admin/orders/:id` receives an adjustment (not a raw total).
2. Service inserts an `order_audit_log` row (old value, new value, actor, reason) and an `order_items` adjustment line (see §7) in one transaction.
3. Order total is re-derived (sum of line items + adjustments), never overwritten directly.

**Low-stock notification:**
1. `POST /api/orders` decrements `products.stock_quantity` as part of the order-creation transaction.
2. If the post-decrement quantity crosses below `low_stock_threshold` (product-level override, else `site_theme`-adjacent global default — see §7.2), the same transaction inserts a `notifications` row. No cron job.

---

## 3. Folder Structure (new/changed paths only — greenfield, so this is everything)

```
anthony_ecom/
  package.json                 # root: npm workspaces ["client", "server"]
  .env.example                 # documents all required env vars (no real values)
  .gitignore                   # already present
  docs/
    architecture.md            # this file
  migrations/                  # Knex migrations, run against the server DB
    knexfile.js
    001_create_users.js
    002_create_categories.js
    003_create_products.js
    004_create_product_images.js
    005_create_product_groups.js
    006_create_product_group_items.js
    007_create_carts.js
    008_create_orders.js
    009_create_order_items.js
    010_create_order_audit_log.js
    011_create_favorites.js
    012_create_notifications.js
    013_create_site_theme.js
    014_create_anon_sessions.js
    seeds/
      001_site_theme_default.js
      002_palettes_note.js       # seeds the single default site_theme row only

  server/
    package.json
    src/
      app.js                   # Express app assembly: helmet, rate limiters, CSRF, routers
      server.js                # entrypoint: http.listen, PM2-friendly
      config/
        env.js                 # reads/validates process.env once, exports typed config object
        db.js                  # Knex instance (single connection pool)
        s3.js                  # S3 client instance, bucket name from env
        palettes.js            # mirrors client/src/theme/palettes.ts IDs only (validation list)
      routes/
        auth.routes.js
        products.routes.js
        categories.routes.js
        groups.routes.js
        cart.routes.js
        favorites.routes.js
        orders.routes.js
        admin.orders.routes.js
        theme.routes.js
        notifications.routes.js
        dashboard.routes.js
        index.js                # mounts all routers under /api
      controllers/
        auth.controller.js
        products.controller.js
        categories.controller.js
        groups.controller.js
        cart.controller.js
        favorites.controller.js
        orders.controller.js
        theme.controller.js
        notifications.controller.js
        dashboard.controller.js
      services/
        auth.service.js         # password hashing, Google OAuth token verify, JWT issue
        cart.service.js         # add/update/remove, merge-on-login algorithm (§6)
        order.service.js        # total derivation, status transitions, stock decrement (§7)
        product.service.js
        upload.service.js       # S3 upload/delete for product images + logo
        notification.service.js # threshold-cross detection + insert
        theme.service.js        # resolves palette_id/custom_colors -> {primary, secondary}
      models/
        user.model.js            # plain functions over Knex, one file per table
        product.model.js
        productImage.model.js
        category.model.js
        productGroup.model.js
        productGroupItem.model.js
        cart.model.js
        order.model.js
        orderItem.model.js
        orderAuditLog.model.js
        favorite.model.js
        notification.model.js
        siteTheme.model.js
        anonSession.model.js
      middleware/
        auth.middleware.js       # requireAuth, requireAdmin
        csrf.middleware.js       # double-submit cookie check on mutating routes
        rateLimit.middleware.js  # per-route limiter configs (login, checkout, admin)
        anonSession.middleware.js# ensures anon_session_id cookie exists
        errorHandler.middleware.js
      utils/
        asyncHandler.js
        apiError.js
    tests/                      # QA-owned, not created by architecture
      .gitkeep

  client/
    package.json
    index.html
    vite.config.ts              # Vite for React build (project default bundler)
    tailwind.config.ts          # CSS-variable-driven color config (§5)
    src/
      main.tsx
      App.tsx
      theme/
        palettes.ts             # SINGLE SOURCE for palette id -> {accent, accentSecondary}
        applyTheme.ts           # writes CSS vars to :root, computes derived tints
        resolveMode.ts          # cookie -> default_mode -> prefers-color-scheme (§5)
        ThemeProvider.tsx
      api/
        client.ts               # fetch wrapper, attaches CSRF token header
        auth.ts
        products.ts
        cart.ts
        orders.ts
        theme.ts
        favorites.ts
        admin.ts
      components/
        ui/                      # shadcn/ui generated components (unmodified vendor output)
        layout/                  # Header, Footer, section renderer (gradient/flat, §5.4)
        product/                 # ProductCard, Gallery, StockBadge
        cart/
        admin/
      pages/
        storefront/
          Home.tsx
          Category.tsx
          Group.tsx
          ProductDetail.tsx
          Cart.tsx
          Checkout.tsx
          OrderConfirmation.tsx
          Account/
            Favorites.tsx
            Orders.tsx
        admin/
          Products.tsx
          ProductForm.tsx
          Groups.tsx
          Orders.tsx
          OrderDetail.tsx
          ThemeSettings.tsx
          Dashboard.tsx
          Notifications.tsx
      hooks/
        useCart.ts
        useAuth.ts
        useTheme.ts
```

**Root `package.json` workspace strategy:** npm workspaces with two members,
`client` and `server`. No shared package needed yet — the only cross-cutting
data (palette definitions) is small enough to mirror as a validation-only
constant on the server (§0 duplication note) rather than justify a third
`packages/shared` workspace. If a second piece of shared logic emerges later,
promote to a `packages/shared` workspace then — not now (less-is-more).

**`.env.example` location:** repo root, documents (names only, no values):
`NODE_ENV, PORT, DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME,
JWT_SECRET, JWT_EXPIRES_IN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
GOOGLE_CALLBACK_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
S3_BUCKET_NAME, COOKIE_DOMAIN, CLIENT_ORIGIN, CSRF_SECRET`.

---

## 4. API Contract

Auth levels: **Public** (no auth), **Customer** (valid JWT cookie, any role),
**Admin** (valid JWT cookie, `users.role = 'admin'`). All mutating endpoints
(POST/PATCH/PUT/DELETE) except `auth/login`, `auth/register`, and the Google
OAuth callback require the CSRF header to match the CSRF cookie.

### 4.1 Auth
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/auth/register` | Public | `{email, password, name}` | `201 {user: {id,email,name,role}}` + sets JWT cookie |
| POST | `/api/auth/login` | Public | `{email, password}` | `200 {user}` + sets JWT cookie; triggers cart merge (§6) |
| GET | `/api/auth/google` | Public | — | 302 redirect to Google consent |
| GET | `/api/auth/google/callback` | Public | Google `code` query param | 302 redirect to client; sets JWT cookie; triggers cart merge |
| POST | `/api/auth/logout` | Customer | — | `204`, clears JWT cookie (anon session cookie untouched) |
| GET | `/api/auth/me` | Customer | — | `200 {user}` |

### 4.2 Products (public read, admin write)
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/products` | Public | query: `category, group, search, sort, page, pageSize, tag` | `200 {items:[Product], total, page, pageSize}` |
| GET | `/api/products/:id` | Public | — | `200 {Product with images[], stockStatus}` (exact `stock_quantity` omitted for non-admin; only `in_stock/low_stock/out_of_stock` per plan §9.1) |
| POST | `/api/admin/products` | Admin | `{name, description, price, sku, category_id, tags[], is_featured, is_bestseller, is_clearance, stock_quantity, low_stock_threshold?}` | `201 {Product}` |
| PUT | `/api/admin/products/:id` | Admin | same shape (partial allowed) | `200 {Product}` |
| DELETE | `/api/admin/products/:id` | Admin | — | `204` (soft-delete: sets `deleted_at`) |
| POST | `/api/admin/products/bulk-delete` | Admin | `{ids: number[]}` | `200 {softDeleted: number[]}` |
| POST | `/api/admin/products/:id/images` | Admin | multipart form-data, one or more files | `201 {images: [ProductImage]}` (uploads to S3 via `upload.service.js`, inserts rows) |
| PATCH | `/api/admin/products/:id/images/:imageId` | Admin | `{is_primary: true}` | `200 {ProductImage}` (unsets prior primary in same transaction) |
| DELETE | `/api/admin/products/:id/images/:imageId` | Admin | — | `204` (deletes S3 object + row) |

### 4.3 Categories
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/categories` | Public | — | `200 {items: [Category]}` |
| POST | `/api/admin/categories` | Admin | `{name, slug}` | `201 {Category}` |
| PUT | `/api/admin/categories/:id` | Admin | `{name?, slug?}` | `200 {Category}` |
| DELETE | `/api/admin/categories/:id` | Admin | — | `204` (blocked with `409` if products still reference it) |

### 4.4 Merchandising Groups
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/groups` | Public | — | `200 {items: [{id, name, description}]}` (the virtual "ALL" group is never in this list; client renders it as a synthetic no-filter tab) |
| GET | `/api/groups/:id/products` | Public | query: `page, pageSize` | `200 {items:[Product], total}` |
| POST | `/api/admin/groups` | Admin | `{name, description?}` | `201 {ProductGroup}` |
| PUT | `/api/admin/groups/:id` | Admin | `{name?, description?}` | `200 {ProductGroup}` |
| DELETE | `/api/admin/groups/:id` | Admin | — | `204` (cascades `product_group_items` rows only, never touches products) |
| PUT | `/api/admin/groups/:id/products` | Admin | `{productIds: number[]}` | `200 {productIds}` (full replace of membership set — used by Groups-page multi-select) |
| PUT | `/api/admin/products/:id/groups` | Admin | `{groupIds: number[]}` | `200 {groupIds}` (full replace — used by product-form multi-select; writes to the same join table as above, so both directions stay in sync automatically per plan §8) |

### 4.5 Cart
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/cart` | Public (anon session or logged in) | — | `200 {items: [{productId, name, price, quantity, imageUrl}], subtotal}` |
| POST | `/api/cart/items` | Public | `{productId, quantity}` | `200 {items[], subtotal}` (upsert: increments if product already in cart) |
| PATCH | `/api/cart/items/:productId` | Public | `{quantity}` | `200 {items[], subtotal}` (quantity `0` removes the line) |
| DELETE | `/api/cart/items/:productId` | Public | — | `200 {items[], subtotal}` |
| DELETE | `/api/cart` | Public | — | `204` (clears entire cart; used post-checkout) |

### 4.6 Favorites
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/favorites` | Customer | — | `200 {items: [Product]}` |
| POST | `/api/favorites/:productId` | Customer | — | `201 {productId}` |
| DELETE | `/api/favorites/:productId` | Customer | — | `204` |

### 4.7 Orders
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/api/orders` | Customer | `{shippingAddress: {...}}` (cart read server-side, not passed in) | `201 {Order}` — status `pending_payment`, see §7 |
| GET | `/api/orders` | Customer | query: `page, pageSize` | `200 {items: [OrderSummary], total}` (own orders only) |
| GET | `/api/orders/:id` | Customer | — | `200 {Order with items[], adjustedTotal}` (404 if not owner and not admin; audit log never included) |
| GET | `/api/admin/orders` | Admin | query: `status, page, pageSize, search` | `200 {items: [OrderSummary], total}` |
| GET | `/api/admin/orders/:id` | Admin | — | `200 {Order with items[], auditLog[]}` |
| PATCH | `/api/admin/orders/:id` | Admin | `{type: 'discount'|'refund'|'shipping_change'|'manual_adjustment'|'status_change', amount?, newStatus?, reason?}` | `200 {Order, auditLogEntry}` — see §7 for derivation rules |

### 4.8 Site Theme
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/theme` | Public | — | `200 {brand_name, tagline, logo_url, resolvedColors:{primary,secondary}, section_styles, default_mode}` |
| PUT | `/api/admin/theme` | Admin | `{brand_name?, tagline?, logo_url?, palette_id?, custom_colors?, section_styles?, default_mode?}` | `200 {SiteTheme}` (single-row upsert; validated against known `palette_id`s or well-formed `custom_colors`) |
| POST | `/api/admin/theme/logo` | Admin | multipart form-data, one file | `201 {logo_url}` (uploads to S3, does not auto-save into `site_theme` — admin still must hit `PUT /api/admin/theme` per plan §6.6 "Save theme is the only persisting action") |

### 4.9 Notifications (admin-facing, low-stock bell)
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/admin/notifications` | Admin | query: `unreadOnly, page, pageSize` | `200 {items: [Notification], unreadCount}` |
| PATCH | `/api/admin/notifications/:id/read` | Admin | — | `200 {Notification}` |
| PATCH | `/api/admin/notifications/read-all` | Admin | — | `204` |

### 4.10 Revenue Dashboard
| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| GET | `/api/admin/dashboard/revenue` | Admin | query: `granularity=daily|monthly, from, to` | `200 {series: [{period, revenue, orderCount}]}` (live query, no cache table per plan §5) |

All error responses use a shared shape: `{error: {code, message, details?}}`
with standard HTTP status codes (400 validation, 401 unauthenticated, 403
forbidden, 404 not found, 409 conflict, 429 rate-limited, 500 server error).

---

## 5. Theming Resolution Algorithm

### 5.1 Color resolution (palette vs. custom → two CSS variables)

Given the active `site_theme` row:
```
if site_theme.palette_id === 'custom':
    primary   = site_theme.custom_colors.primary
    secondary = site_theme.custom_colors.secondary
else:
    { accent, accentSecondary } = palettes[site_theme.palette_id]   // from client/src/theme/palettes.ts
    primary   = accent
    secondary = accentSecondary
```
The server's `/api/theme` response always returns the **already-resolved**
`resolvedColors: {primary, secondary}` (computed in `theme.service.js` using
the server-mirrored palette list, §0/§3 duplication note) — the client never
needs to know whether the origin was a preset or custom; it just applies the
two values. This is the "both variants resolve to the same two values"
requirement from plan §6.2/§6.3.

`applyTheme.ts` (client) then:
1. Sets `--brand-primary` and `--brand-secondary` on `document.documentElement`.
2. Computes derived tints (e.g. `--brand-primary-tint-10`, `-90`, hover/active
   shades) via a small color utility (HSL lighten/darken of the two base
   values) — no additional colors are ever fetched from the server.
3. Tailwind config maps its color tokens to these CSS variables (e.g.
   `colors: { brand: { DEFAULT: 'var(--brand-primary)', secondary: 'var(--brand-secondary)' } }`)
   so components use `bg-brand`, `text-brand-secondary`, etc. — never a
   literal `bg-blue-500`-style utility class, per plan §6.3.

### 5.2 Section rendering (gradient vs flat)

`site_theme.section_styles` is a JSON map, e.g.
`{ "hero": "gradient", "featured": "flat", "groupBanner": "gradient", "footer": "flat" }`.
A single `<SectionSurface variant={style}>` layout component (in
`client/src/components/layout/`) renders:
- `gradient` → inline style `background: linear-gradient(135deg, var(--brand-primary), var(--brand-secondary))`
- `flat` → inline style `background: var(--brand-primary)`

Every section on the homepage/group pages wraps its content in
`<SectionSurface variant={theme.section_styles[sectionKey]}>` — one component,
two branches, zero duplicated color logic (plan §6.4).

### 5.3 Dark / light / auto mode resolution

Priority order, evaluated once per page load in `resolveMode.ts`:
```
1. If cookie "theme_mode" is present (value "dark" or "light") -> use it directly.
2. Else -> read site_theme.default_mode:
   a. if default_mode === 'light' -> use 'light'
   b. if default_mode === 'dark'  -> use 'dark'
   c. if default_mode === 'auto'  -> resolve via window.matchMedia('(prefers-color-scheme: dark)')
                                      to a concrete 'dark'/'light' value, ONCE (not re-evaluated
                                      on subsequent OS theme changes within the session)
3. Set data-mode="<resolved>" on <html>.
4. Do NOT write a cookie yet in step 2/c — the cookie is only written when the
   user explicitly toggles via the header switch (plan: "auto resolves ... not
   re-checked every load" describes the toggle's write, not an implicit write
   on every anonymous load; writing on mere resolution would defeat the "no
   cookie -> fall back to default_mode" branch on the very next request).
```
The header toggle: on click, compute the new value, call
`document.documentElement.setAttribute('data-mode', value)`, and set
`document.cookie = "theme_mode=<value>; Max-Age=31536000; Path=/; SameSite=Lax"`
directly client-side — no server round-trip (plan §6.5).

Neutral surface/text CSS tokens (shadcn defaults, mode-aware via
`data-mode`/Tailwind `dark:` variant) handle contrast; `--brand-primary`/
`--brand-secondary` hue does not change between modes (plan §6.5, last bullet).

### 5.4 Live preview vs persistence

`ThemeSettings.tsx` (admin) applies palette/custom-color/section-style edits
to the CSS variables immediately client-side (calling the same `applyTheme.ts`
function used at boot, but with in-memory draft values, not a server round
trip). Only clicking "Save theme" issues `PUT /api/admin/theme`. Navigating
away without saving discards the preview (plan §6.6) — this is a client-only
concern, no backend support needed beyond the existing `PUT`.

---

## 6. Cart Merge-on-Login Algorithm

Trigger: immediately after successful `POST /api/auth/login`, the Google
OAuth callback, or `POST /api/auth/register`, before the response is sent,
inside a single DB transaction, using the `anon_session_id` cookie value
present on the request (if any) and the just-authenticated `user_id`.

```
BEGIN TRANSACTION

anonRows   = SELECT * FROM carts WHERE session_id = :sessionId AND user_id IS NULL
userRows   = SELECT * FROM carts WHERE user_id = :userId

if anonRows is empty:
    COMMIT   -- nothing to merge

else:
    userRowsByProduct = map(userRows, row => row.product_id)

    for each anonRow in anonRows:
        if anonRow.product_id in userRowsByProduct:
            matchingUserRow = userRowsByProduct[anonRow.product_id]
            UPDATE carts
               SET quantity = matchingUserRow.quantity + anonRow.quantity
             WHERE cart_id = matchingUserRow.cart_id
            DELETE FROM carts WHERE cart_id = anonRow.cart_id
        else:
            UPDATE carts
               SET user_id = :userId, session_id = NULL
             WHERE cart_id = anonRow.cart_id

    COMMIT

-- anon_session_id cookie itself is left as-is (harmless — no rows reference
-- it after merge); a fresh anon session cookie is only reissued the next
-- time an unauthenticated cart-touching request occurs (e.g. after logout).
```

Precise rules for QA to test against:
- **Quantities are summed on conflict** (same `product_id` in both anon and
  user cart), never overwritten, never averaged, never capped except by
  normal stock validation applied at checkout time (not at merge time — merge
  never fails due to stock, per "no cron/no side validation" simplicity;
  stock is only enforced at order creation).
- Rows with no conflicting product are **reassigned** (`UPDATE ... SET
  user_id, session_id = NULL`), not copied — the original anonymous cart row
  ceases to exist as an anonymous row after merge, consistent with "reassign
  session_id rows to user_id" in plan §9.3.
- Merge is idempotent per login event: if a user logs in with no anonymous
  cart cookie present, or with an anon cart that's already empty, no rows
  change and no error occurs.
- Merge runs on **every** login/register/OAuth event where an anon session
  cookie with cart rows exists — including a user logging in on a second
  device that already had items in their user cart from device 1 (that's the
  `userRows` conflict-check path).
- This logic lives in exactly one place: `server/src/services/cart.service.js`
  (e.g. `mergeAnonCartIntoUser(sessionId, userId, trx)`), called from
  `auth.service.js` — not reimplemented per auth method.

---

## 7. Order Model

### 7.1 Total derivation (never a raw editable total)

`orders` never stores an admin-editable `total` column directly settable by a
PATCH. Instead:

- `order_items` holds one row per purchased product line
  (`unit_price × quantity` captured at time of purchase — a price snapshot,
  immune to later product price changes) **plus** rows of `item_type =
  'adjustment'` for admin-added manual adjustments (discount, partial refund,
  shipping change), each with a signed `amount` (negative for
  discounts/refunds, positive for added shipping/fees) and a `label`.
- `orders.subtotal`, `orders.adjustment_total`, and `orders.total` are
  **derived, stored, denormalized columns**, recomputed and rewritten inside
  the same transaction any time an `order_items` row is inserted for that
  order (at creation, and on every admin adjustment). They exist for fast
  reads (order list/detail, dashboard) but are never the write target of an
  API call — no endpoint accepts `{total: ...}`.

```
subtotal         = SUM(order_items.unit_price * order_items.quantity WHERE item_type = 'line')
adjustment_total = SUM(order_items.amount WHERE item_type = 'adjustment')
total            = subtotal + adjustment_total
```

- `PATCH /api/admin/orders/:id` with `type: 'discount'|'refund'|
  'shipping_change'|'manual_adjustment'` inserts one `order_items` adjustment
  row (never mutates an existing line item), recomputes the three order
  totals above, and inserts one `order_audit_log` row capturing
  `field_changed = 'total'`, `old_value`, `new_value`, `actor_user_id`,
  `reason`, `created_at` — all in one transaction.
- `type: 'status_change'` updates `orders.status` directly (no total impact)
  and still writes an `order_audit_log` row (`field_changed = 'status'`).
- Reconciling any money-affecting adjustment with an actual Stripe
  refund/charge is explicitly out of scope until Stripe is designed (plan
  §7, last bullet) — the `order_audit_log` row is sufficient groundwork; no
  Stripe call is made by this endpoint today.

### 7.2 Stock & low-stock notification

- `order.service.js`, inside the same transaction as `POST /api/orders`,
  decrements `products.stock_quantity` per line item and re-reads the new
  quantity.
- Threshold = `products.low_stock_threshold` if non-null, else a single
  global default. Architecture decision: the global default is a config
  value (`server/src/config/env.js` → `DEFAULT_LOW_STOCK_THRESHOLD`, e.g.
  `5`), not a DB row — the plan only specifies "global default + optional
  per-product override" and doesn't tie it to `site_theme`, so introducing a
  new one-row settings table for a single integer would be unjustified
  speculative structure (less-is-more). If a future requirement needs this
  admin-editable at runtime, add one column to `site_theme` then.
- If new quantity `<= threshold` and old quantity `> threshold` (i.e. this
  order is what crossed it), insert one `notifications` row
  (`type='low_stock', product_id, message, is_read=false`).

### 7.3 Checkout status seam for Stripe (deferred)

- `POST /api/orders` creates the order with `status = 'pending_payment'`
  immediately after cart snapshot + stock decrement — no payment step occurs
  today.
- `orders.status` enum includes `'processing'` as the next state a future
  Stripe webhook handler would transition into after a successful charge.
  The seam: a not-yet-implemented `POST /api/orders/:id/confirm-payment`
  (or a Stripe webhook receiver) would be the only place that flips
  `pending_payment -> processing`. No such route exists yet; this is
  intentionally the stopping point per plan §1/§10.

---

## 8. Database Schema (MySQL 8, standard features only — no JSON path indexes, no CTEs required, no generated columns beyond simple ones)

Conventions: every table has `id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY`
unless noted; timestamps are `DATETIME` (app sets values in UTC); soft-delete
uses a nullable `deleted_at DATETIME`; all FKs use `ON DELETE RESTRICT` unless
noted otherwise (explicit per relationship below); charset
`utf8mb4` / collation `utf8mb4_unicode_ci` at table level.

### `users`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| email | VARCHAR(255) | UNIQUE, NOT NULL |
| password_hash | VARCHAR(255) | NULLABLE (OAuth-only accounts have no password) |
| provider | ENUM('local','google') | NOT NULL |
| provider_id | VARCHAR(255) | NULLABLE, Google's `sub` claim when provider='google' |
| name | VARCHAR(255) | NOT NULL |
| role | ENUM('customer','admin') | NOT NULL DEFAULT 'customer' |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Indexes: UNIQUE `(email)`; UNIQUE `(provider, provider_id)` where `provider_id IS NOT NULL`.

### `categories`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| name | VARCHAR(120) | NOT NULL |
| slug | VARCHAR(140) | UNIQUE, NOT NULL |
| created_at | DATETIME | NOT NULL |

### `products`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| category_id | INT UNSIGNED | FK → `categories.id`, NOT NULL, ON DELETE RESTRICT |
| name | VARCHAR(255) | NOT NULL |
| description | TEXT | NULLABLE |
| price | DECIMAL(10,2) | NOT NULL |
| sku | VARCHAR(64) | UNIQUE, NOT NULL |
| tags | JSON | NULLABLE — small denormalized array of strings; not queried relationally, so a join table is unjustified structure for the current requirement |
| stock_quantity | INT UNSIGNED | NOT NULL DEFAULT 0 |
| low_stock_threshold | INT UNSIGNED | NULLABLE (per-product override; NULL = use global default, §7.2) |
| is_featured | TINYINT(1) | NOT NULL DEFAULT 0 |
| is_bestseller | TINYINT(1) | NOT NULL DEFAULT 0 |
| is_clearance | TINYINT(1) | NOT NULL DEFAULT 0 |
| deleted_at | DATETIME | NULLABLE (soft-delete, plan §3) |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Indexes: `INDEX (category_id)`, `INDEX (is_featured)`, `INDEX (is_bestseller)`,
`INDEX (is_clearance)`, `INDEX (deleted_at)`, FULLTEXT `(name, description)`
for search (`GET /api/products?search=`).

### `product_images`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| product_id | INT UNSIGNED | FK → `products.id`, NOT NULL, ON DELETE CASCADE |
| url | VARCHAR(500) | NOT NULL (S3 object URL) |
| is_primary | TINYINT(1) | NOT NULL DEFAULT 0 |
| sort_order | SMALLINT UNSIGNED | NOT NULL DEFAULT 0 |
| created_at | DATETIME | NOT NULL |

Indexes: `INDEX (product_id)`. Application enforces (in a transaction, not a
DB constraint) that at most one `is_primary=1` row exists per `product_id`.

### `product_groups`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| name | VARCHAR(120) | NOT NULL |
| description | VARCHAR(500) | NULLABLE |
| created_at | DATETIME | NOT NULL |

Note: the "ALL" group is virtual per plan §8 — no row, no seed, no special ID.

### `product_group_items`
| Column | Type | Notes |
|---|---|---|
| group_id | INT UNSIGNED | FK → `product_groups.id`, ON DELETE CASCADE |
| product_id | INT UNSIGNED | FK → `products.id`, ON DELETE CASCADE |

PK: composite `(group_id, product_id)`. Indexes: `INDEX (product_id)` (for
"which groups is this product in" lookups used by the product-form
multi-select).

### `anon_sessions`
| Column | Type | Notes |
|---|---|---|
| session_id | CHAR(36) | PK (UUID, matches the `anon_session_id` cookie value) |
| created_at | DATETIME | NOT NULL |
| last_seen_at | DATETIME | NOT NULL |

Purpose: lets `carts.session_id` be a real FK (referential integrity + easy
cleanup/analytics on abandoned carts, plan §9.3 "bonus") rather than a bare
unchecked string. Row is created by `anonSession.middleware.js` the first
time an unauthenticated visitor's cookie is missing; `last_seen_at` is
touched opportunistically (not on every single request) to bound write load.

### `carts`
| Column | Type | Notes |
|---|---|---|
| cart_id | INT UNSIGNED AUTO_INCREMENT | PK |
| session_id | CHAR(36) | FK → `anon_sessions.session_id`, NULLABLE, ON DELETE SET NULL |
| user_id | INT UNSIGNED | FK → `users.id`, NULLABLE, ON DELETE CASCADE |
| product_id | INT UNSIGNED | FK → `products.id`, NOT NULL, ON DELETE CASCADE |
| quantity | INT UNSIGNED | NOT NULL |
| added_at | DATETIME | NOT NULL |

Constraint (application-enforced, documented here for clarity): exactly one
of `session_id` / `user_id` is non-null at any time — matches plan §9.3
exactly (`cart_id, session_id, user_id (nullable), product_id, quantity,
added_at`). Indexes: UNIQUE `(session_id, product_id)`, UNIQUE
`(user_id, product_id)` (both allowing NULL session_id/user_id respectively,
which MySQL treats as distinct for uniqueness — safe for this use) to make
the cart-merge upsert logic in §6 straightforward; `INDEX (product_id)`.

### `orders`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| user_id | INT UNSIGNED | FK → `users.id`, NOT NULL, ON DELETE RESTRICT (no guest checkout, plan §9.4) |
| status | ENUM('pending_payment','processing','shipped','delivered','cancelled','refunded') | NOT NULL DEFAULT 'pending_payment' |
| shipping_address | JSON | NOT NULL (line1, line2, city, region, postal_code, country, recipient_name) |
| subtotal | DECIMAL(10,2) | NOT NULL, derived (§7.1) |
| adjustment_total | DECIMAL(10,2) | NOT NULL DEFAULT 0, derived (§7.1) |
| total | DECIMAL(10,2) | NOT NULL, derived (§7.1) |
| created_at | DATETIME | NOT NULL |
| updated_at | DATETIME | NOT NULL |

Indexes: `INDEX (user_id)`, `INDEX (status)`, `INDEX (created_at)` (revenue
dashboard range queries).

### `order_items`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| order_id | INT UNSIGNED | FK → `orders.id`, NOT NULL, ON DELETE CASCADE |
| item_type | ENUM('line','adjustment') | NOT NULL |
| product_id | INT UNSIGNED | FK → `products.id`, NULLABLE (NULL for `adjustment` rows), ON DELETE SET NULL |
| label | VARCHAR(255) | NOT NULL (product name snapshot for `line`; e.g. "Manual discount" / "Refund — damaged item" for `adjustment`) |
| unit_price | DECIMAL(10,2) | NULLABLE (used for `line` rows only) |
| quantity | INT UNSIGNED | NULLABLE (used for `line` rows only, DEFAULT 1) |
| amount | DECIMAL(10,2) | NULLABLE (used for `adjustment` rows only; signed — negative = discount/refund, positive = added fee/shipping) |
| created_at | DATETIME | NOT NULL |

Indexes: `INDEX (order_id)`, `INDEX (product_id)`.

### `order_audit_log`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| order_id | INT UNSIGNED | FK → `orders.id`, NOT NULL, ON DELETE CASCADE |
| actor_user_id | INT UNSIGNED | FK → `users.id`, NOT NULL (always an admin) |
| field_changed | VARCHAR(64) | NOT NULL (e.g. `'total'`, `'status'`) |
| old_value | VARCHAR(255) | NULLABLE |
| new_value | VARCHAR(255) | NOT NULL |
| reason | VARCHAR(500) | NULLABLE |
| created_at | DATETIME | NOT NULL |

Indexes: `INDEX (order_id)`, `INDEX (created_at)`.

### `favorites`
| Column | Type | Notes |
|---|---|---|
| user_id | INT UNSIGNED | FK → `users.id`, ON DELETE CASCADE |
| product_id | INT UNSIGNED | FK → `products.id`, ON DELETE CASCADE |
| created_at | DATETIME | NOT NULL |

PK: composite `(user_id, product_id)`. Indexes: `INDEX (product_id)`.

### `notifications`
| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK |
| type | ENUM('low_stock') | NOT NULL (single value today; enum kept narrow per less-is-more — extend when a second type is actually needed) |
| product_id | INT UNSIGNED | FK → `products.id`, NULLABLE, ON DELETE CASCADE |
| message | VARCHAR(500) | NOT NULL |
| is_read | TINYINT(1) | NOT NULL DEFAULT 0 |
| created_at | DATETIME | NOT NULL |

Indexes: `INDEX (is_read)`, `INDEX (created_at)`.

### `site_theme`
Single-row table (application enforces exactly one row; no `user_id` scoping
— this is a white-label deployment-wide setting, not per-user).

| Column | Type | Notes |
|---|---|---|
| id | INT UNSIGNED AUTO_INCREMENT | PK (always `1` in practice) |
| brand_name | VARCHAR(120) | NOT NULL |
| tagline | VARCHAR(255) | NULLABLE |
| logo_url | VARCHAR(500) | NULLABLE (S3 URL) |
| palette_id | VARCHAR(32) | NOT NULL, e.g. `'ocean'`, `'sunset'`, `'earth'`, or `'custom'` |
| custom_colors | JSON | NULLABLE, populated only when `palette_id = 'custom'`: `{"primary": "#hex", "secondary": "#hex"}` |
| section_styles | JSON | NOT NULL, e.g. `{"hero":"gradient","featured":"flat","groupBanner":"gradient","footer":"flat"}` |
| default_mode | ENUM('light','dark','auto') | NOT NULL DEFAULT 'auto' |
| updated_at | DATETIME | NOT NULL |

No indexes beyond PK needed (single row, read on nearly every request —
consider caching in-process with a short TTL or invalidate-on-write if load
becomes a concern; not needed at current scale, so not built now).

---

## 9. Security Notes (implementation-relevant, not exhaustive)

- **Helmet**: default config in `app.js`, plus explicit `contentSecurityPolicy`
  connect-src allowance for the S3 bucket domain (images) and Google OAuth
  domains.
- **Rate limiting**: per-route limiters via `rateLimit.middleware.js` —
  stricter on `POST /api/auth/login` and `POST /api/orders` (brute-force /
  checkout-abuse surfaces) than on general `GET` catalog browsing.
- **CSRF**: double-submit cookie token issued on session start (any request),
  required as a header (`X-CSRF-Token`) on every mutating cart, checkout, and
  admin endpoint (see §4 auth column — every non-GET route except the two
  auth-establishing routes noted). The JWT auth cookie is `httpOnly`,
  `SameSite=Lax`, `Secure` in production; the CSRF cookie is deliberately
  **not** `httpOnly` (client JS must read it to echo it back as a header).
- **Anon session cookie** (`anon_session_id`) is `httpOnly`, long-lived,
  `SameSite=Lax` — mirrors the `theme_mode` cookie's lax same-site posture
  described in plan §6.5, but is not readable/writable by client JS (unlike
  `theme_mode`, which must be, since the header toggle rewrites it directly).

---

## 10. Deployment Shape (for devops-agent — not designed in full here)

- `client/` builds to static assets served by Caddy directly.
- `server/` runs under PM2 (`server/src/server.js` as entrypoint), Caddy
  reverse-proxies `/api/*` to the Express process, everything else to the
  static client build (SPA fallback to `index.html`).
- MySQL is the existing remote Hostinger instance — the app is a client to
  it (`config/db.js` reads `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME` from env);
  no local MySQL is provisioned by this repo.
- Actual Caddyfile, PM2 ecosystem file, and CI/deploy scripts are out of
  scope for this document — devops-agent designs those against the ports/
  entrypoints stated above.

---

## 11. Open Items / Deferred

- **Stripe integration**: entirely deferred per plan §1/§7/§10. This
  architecture stops at `orders.status = 'pending_payment'` and defines
  `'processing'` as the next enum value a future payment-confirmation
  endpoint/webhook would set. No Stripe SDK, keys, webhook route, or refund
  API call is designed here. When undertaken, it will need: a webhook
  receiver route, idempotency handling, and wiring the `order_audit_log`
  money-adjustment path (§7.1) to actual Stripe refund/charge calls (plan
  §7, last bullet).
- **S3 bucket availability untested**: the S3 integration points
  (`server/src/config/s3.js`, `upload.service.js`, product-image and
  logo-upload endpoints) are designed against the standard
  `@aws-sdk/client-s3` API but have not been verified against a real bucket
  in this session. Backend engineer should confirm bucket/region/IAM
  permissions exist before relying on uploads working end-to-end; env vars
  are already named in `.env.example` (§3).
- **Revenue rollup/cache table**: intentionally not designed now — plan §5
  says start with live queries; add a rollup table only if a real
  performance problem shows up.
- **Order-modification admin UI layout**: plan §10 notes this screen isn't
  drafted yet; the API contract (§4.7) and total-derivation model (§7.1) are
  final and sufficient for a frontend engineer to build any reasonable
  layout against.
- **Global low-stock default storage**: currently an env/config constant
  (§7.2), not a DB row — revisit only if admin needs to change it without a
  redeploy.

---

## Out of Scope for This Document

Per the architect role's boundaries: this document contains no implementation
code and no migration file contents — `migrations/*.js` file names above are
placeholders for the database engineer to author using the exact column
definitions in §8. Actual Knex migration syntax, Express route handler
bodies, and React component internals are implementation work for the
Backend, Frontend, and Database engineer agents, not this document.
