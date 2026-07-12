# Test Plan — White-Label E-Commerce Template

Authoritative behavior source: `docs/architecture.md`. This plan covers the
full app at a summary level for manual/exploratory QA, and calls out the
four areas that already have real automated coverage.

All automated tests here run against an isolated, in-memory (better-sqlite3)
Knex database — never the live Hostinger MySQL instance. See "Automated
coverage" at the bottom for how to run them.

---

## 1. Auth (register / login / Google OAuth / logout / me)

- Register with a new email → 201, JWT cookie set, user row created with
  `provider='local'`, password hashed (never stored/returned in plaintext).
- Register with a duplicate email → 409/400, no duplicate row.
- Login with correct / incorrect password → 200 with cookie / 401.
- Google OAuth callback (manual, requires real `GOOGLE_CLIENT_ID`/secret) →
  302 redirect, JWT cookie set, user row created or matched by
  `(provider, provider_id)`.
- `GET /api/auth/me` with no cookie → 401; with valid cookie → 200 `{user}`.
- Logout → JWT cookie cleared, `anon_session_id` cookie untouched (still
  present, unrelated concern per architecture.md §1).
- **Cart merge on login/register/OAuth callback → covered by automated
  tests, see `server/tests/cart.service.test.js`.**

## 2. Product browsing (storefront)

- `GET /api/products` — pagination, `sort` (price/name/newest), `search`
  (FULLTEXT), `tag` (JSON_CONTAINS), `category`/`group` filters, combinations
  thereof.
- `GET /api/products/:id` — returns `stockStatus` (`in_stock`/`low_stock`/
  `out_of_stock`) for non-admin, never the raw `stock_quantity`; 404 for
  soft-deleted or nonexistent products.
- Homepage sections (featured/bestseller/clearance) reflect the correct
  boolean flags; group pages (`GET /api/groups/:id/products`) return only
  members of that group; the virtual "ALL" group renders as a no-filter tab
  client-side only (no matching server route/row).
- Category delete blocked (`409`) while products still reference it.

## 3. Cart (pre-login and logged-in)

- Add/update/remove/clear cart as anonymous visitor (session cookie-backed)
  and as a logged-in user; quantity `0` on PATCH removes the line.
- Adding the same product twice increments quantity (upsert), doesn't
  duplicate rows.
- Cart persists across page reloads (anon session cookie) and is scoped
  per-user once logged in.
- **Merge-on-login algorithm (sum on conflict, reassign non-conflicting
  rows, idempotency) → covered by automated tests, see
  `server/tests/cart.service.test.js`.**

## 4. Checkout → pending payment

- Checkout with items in cart → `201 Order` with `status='pending_payment'`,
  cart cleared after order creation, shipping address snapshotted as JSON.
- Checkout with an empty cart → `400`.
- No guest checkout: unauthenticated checkout attempt → `401`.
- Order confirmation page (`GET /api/orders/:id`) shows items + total,
  never the internal audit log, and 404s for a non-owner non-admin caller.
- **Total derivation (subtotal/adjustment_total/total) and stock
  decrement + low-stock notification trigger → covered by automated
  tests, see `server/tests/order.service.test.js` and
  `server/tests/notification.service.test.js`.**

## 5. Favorites

- Add/remove a favorite as a logged-in customer; duplicate add is a no-op
  or idempotent (no duplicate PK violation surfaced to the client).
- `GET /api/favorites` returns only the current user's favorited products.
- Favoriting requires auth (401 if anonymous).

## 6. Order history (customer-facing)

- `GET /api/orders` — own orders only, paginated, newest first.
- Order detail shows line items + adjusted (final) total, not raw audit log.
- Attempting to view another customer's order by ID → 404 (not 403 — avoids
  leaking order existence).

## 7. Admin — product management

- Create/edit/soft-delete a product; soft-deleted products disappear from
  public listings but remain visible/editable in admin (verify via
  `deleted_at`).
- Bulk delete via multi-select → all-or-nothing per ID, returns the
  soft-deleted ID list.
- Image upload (multipart, S3) → image row(s) created; setting
  `is_primary` on one image unsets any prior primary for that product in the
  same transaction; image delete removes both the S3 object and the row.
  *(Flagged in architecture.md §11 as untested against a real bucket —
  confirm S3 credentials/bucket/region/IAM before relying on this
  end-to-end.)*
- Group assignment stays bidirectional: assigning groups from the product
  form and assigning products from the Groups page both write the same
  join table and stay in sync.

## 8. Admin — order management

- `PATCH /api/admin/orders/:id` with `type=discount|refund|shipping_change|
  manual_adjustment` → inserts an adjustment line + audit log row, never
  accepts a raw `{total}`.
- `type=status_change` → updates status only, still audit-logged.
- Invalid/unknown adjustment type, or a money type missing `amount` → 400.
- Admin order list: filter by `status`, `search` (name/email/order ID).

## 9. Admin — theme management

- `PUT /api/admin/theme` — preset `palette_id` vs `custom` with
  `custom_colors`; validation rejects an unknown `palette_id` or a
  `custom` palette missing `primary`/`secondary`.
- Live preview in `ThemeSettings.tsx` updates CSS variables immediately,
  in-browser only; navigating away without clicking "Save theme" discards
  the draft (no partial persistence).
- Logo upload (`POST /api/admin/theme/logo`) uploads to S3 but does **not**
  auto-save into `site_theme` — a subsequent `PUT` is still required.
- Section styles (`gradient`/`flat`) render correctly per section via
  `SectionSurface`.
- **Dark/light/auto mode resolution priority (cookie → default_mode →
  prefers-color-scheme, resolved once, never written back merely from
  resolution) → covered by automated tests, see
  `client/src/theme/__tests__/resolveMode.test.ts`.**
- Color resolution (`resolvedColors` from either a preset or custom palette
  resolving to the same two-value shape) is exercised indirectly by
  `theme.service.js`'s `resolveColors` — worth a follow-up unit test if this
  file gets touched again; not one of the four designated trickiest paths
  for this pass.

## 10. Notifications (admin low-stock bell)

- `GET /api/admin/notifications` — `unreadOnly` filter, pagination,
  `unreadCount`.
- Mark-one-read and mark-all-read update `is_read` correctly and don't
  affect unrelated rows.
- **Low-stock threshold-cross detection (per-product override vs. global
  default, exact boundary, no double-notify) → covered by automated tests,
  see `server/tests/notification.service.test.js` (isolated) and
  `server/tests/order.service.test.js` (integration through
  `createOrder`).**

## 11. Revenue dashboard

- `GET /api/admin/dashboard/revenue` — `daily`/`monthly` granularity,
  `from`/`to` range filtering, excludes `cancelled`/`refunded` orders from
  revenue sums (per `order.model.js`'s `REVENUE_EXCLUDED_STATUSES`).
- Recharts renders the returned series without a client-side recompute of
  revenue (server is the sole source of truth per architecture.md §0).

## 12. Cross-cutting / security (spot-check manually)

- CSRF: mutating cart/checkout/admin requests without a matching
  `X-CSRF-Token` header → 403; `auth/login`, `auth/register`, and the OAuth
  callback are correctly exempted.
- Rate limiting: repeated rapid `POST /api/auth/login` and
  `POST /api/orders` hit their stricter limiters before general catalog
  browsing does.
- Helmet headers present on all responses; CSP allows the S3 image domain
  and Google OAuth domains without allowing arbitrary origins.

---

## Automated coverage (implemented this pass)

Run:

```
cd server && npm test     # vitest run — 23 tests across 3 files, in-memory better-sqlite3 DB
cd client && npm test     # vitest run — 10 tests, happy-dom environment
```

| Area | File(s) |
|---|---|
| Cart merge-on-login (architecture.md §6) | `server/tests/cart.service.test.js` |
| Order total derivation (architecture.md §7.1) | `server/tests/order.service.test.js` |
| Low-stock threshold trigger (architecture.md §7.2) | `server/tests/notification.service.test.js`, plus integration cases in `server/tests/order.service.test.js` |
| Theme mode resolution priority (architecture.md §5.3) | `client/src/theme/__tests__/resolveMode.test.ts` |

Shared test-only fixtures: `server/tests/helpers/testDb.js` (in-memory schema
builder) and `server/tests/helpers/isolateDb.js` (safely redirects
`config/db.js`'s module cache to the in-memory instance for the two service
functions that open their own `db.transaction(...)` — see that file's
header comment for why a plain `vi.mock` was not reliable here).
