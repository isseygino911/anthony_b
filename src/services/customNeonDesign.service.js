const db = require('../config/db');
const customNeonDesignModel = require('../models/customNeonDesign.model');
const productModel = require('../models/product.model');
const productImageModel = require('../models/productImage.model');
const categoryModel = require('../models/category.model');
const userModel = require('../models/user.model');
const uploadService = require('../services/upload.service');
const cartService = require('./cart.service');
const productEmbeddingSyncService = require('./productEmbeddingSync.service');
const productSeoSyncService = require('./productSeoSync.service');
const ApiError = require('../utils/apiError');
const { signImageUrl } = require('../utils/signedImageUrl');
const { isConfigured: geminiIsConfigured } = require('../config/gemini');

const CUSTOM_NEON_CATEGORY_SLUG = 'custom-neon-signs';

// Not admin-configurable today — revisit if pricing needs to change per-design.
const SIZE_PRICES = { small: 249.99, medium: 399.99, large: 524.99 };
const SIZE_DIMENSIONS = { small: '12"x12"', medium: '24"x24"', large: '36"x36"' };
// Preset whitelist for the neon_color column (varchar(32), not an enum — no
// migration needed to extend this). Every value must also have a COLOR_LABELS
// entry in neonPromptTemplate.service.js: that label is what actually reaches
// Gemini, so a value added here but not there silently generates the wrong
// colour. Customer-picked colours are not listed here — they take the
// "custom:#rrggbb" form validated by CUSTOM_COLOR_RE below.
const NEON_COLORS = [
  'amber',
  'pink',
  'blue',
  'white',
  'red',
  'green',
  'purple',
  'orange',
  'ice-blue',
  'warm-white',
];

// The custom colour picker stores its value inline in the same column as
// "custom:#rrggbb" (14 chars — comfortably inside varchar(32)), so it needs
// neither a second column nor a migration. Strict and canonical on purpose:
// lowercase 6-digit hex only, no /i flag, no 3-digit shorthand, anchored at
// both ends. That keeps arbitrary user text out of the column, out of the
// customer-facing product description, and out of the Gemini prompt.
// describeHex() in neonPromptTemplate.service.js is the counterpart that turns
// the hex into prompt wording — keep the two in sync the same way NEON_COLORS
// and COLOR_LABELS are kept in sync.
const CUSTOM_COLOR_RE = /^custom:#[0-9a-f]{6}$/;

// Lowercases custom values so one colour has exactly one stored form. This is
// load-bearing, not tidiness: the storefront decides whether the rendered
// preview is stale with a plain === on this string (matchesGenerated in
// pages/storefront/CustomNeon.tsx), so allowing both "custom:#FF2D95" and
// "custom:#ff2d95" would make the same colour compare unequal and block
// Confirm. Presets and non-strings pass through untouched.
function normalizeNeonColor(neonColor) {
  if (typeof neonColor !== 'string') return neonColor;
  return neonColor.startsWith('custom:') ? neonColor.toLowerCase() : neonColor;
}

function isValidNeonColor(neonColor) {
  // String(... ?? '') so null/undefined still fail rather than throwing.
  return NEON_COLORS.includes(neonColor) || CUSTOM_COLOR_RE.test(String(neonColor ?? ''));
}

// The stored value is a machine token for custom picks; anything customer- or
// admin-facing goes through here so it reads "custom #FF2D95" rather than
// "custom:#ff2d95". Mirrored by formatNeonColor() in anthony_f/src/api/customNeon.ts.
function describeColorForCustomer(neonColor) {
  const match = /^custom:(#[0-9a-f]{6})$/.exec(String(neonColor ?? ''));
  return match ? `custom ${match[1].toUpperCase()}` : neonColor;
}

function assertSizeAndColor(size, neonColor) {
  if (!SIZE_PRICES[size]) throw ApiError.badRequest('Invalid size');
  if (!isValidNeonColor(neonColor)) throw ApiError.badRequest('Invalid neon_color');
}

function toModelIdentity(identity) {
  return { userId: identity.user?.id ?? null, sessionId: identity.anonSessionId ?? null };
}

function assertIdentity(identity) {
  if (!identity.user && !identity.anonSessionId) throw ApiError.badRequest('No design identity available');
}

// Active-design lookup keyed on whichever half of the identity is set —
// same "exactly one of the two" convention as belongsToIdentity.
function findActive(identity) {
  if (identity.user) return customNeonDesignModel.findActiveByUserId(identity.user.id);
  return customNeonDesignModel.findActiveBySessionId(identity.anonSessionId);
}

// The bucket has Block Public Access, so every stored S3 URL needs signing
// before it reaches the browser — signImageUrl() already handled
// generated_image_url, but sourceImageUrl/renderedImageUrl live one level
// down inside the JSON input_payload blob and were being returned unsigned
// (403s in the browser). Sign whichever of the two is present.
async function shapeInputPayload(payload) {
  const signed = { ...payload };
  if (signed.sourceImageUrl) signed.sourceImageUrl = await signImageUrl(signed.sourceImageUrl);
  if (signed.renderedImageUrl) signed.renderedImageUrl = await signImageUrl(signed.renderedImageUrl);
  return signed;
}

async function shapeDesign(row) {
  const inputPayload = typeof row.input_payload === 'string' ? JSON.parse(row.input_payload) : row.input_payload;
  return {
    id: row.id,
    designType: row.design_type,
    inputPayload: await shapeInputPayload(inputPayload),
    size: row.size,
    neonColor: row.neon_color,
    price: row.price !== null ? Number(row.price) : null,
    status: row.status,
    attempts: row.attempts,
    lastError: row.last_error,
    generatedImageUrl: await signImageUrl(row.generated_image_url),
    imagesPurgedAt: row.images_purged_at,
    productId: row.product_id,
    isShowcased: Boolean(row.is_showcased),
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ACTIVE_GENERATION_ERROR = 'You already have a design generating — please wait for it to finish';

async function createDesign(identity, { designType, file, strokes, text, fontFamily, size, neonColor }) {
  assertIdentity(identity);
  if (!file) throw ApiError.badRequest('No design image uploaded');
  if (!['upload', 'draw', 'text'].includes(designType)) throw ApiError.badRequest('Invalid design_type');
  // Canonicalise before validating so the stored form is the one the
  // storefront's stale-preview comparison expects (see normalizeNeonColor).
  neonColor = normalizeNeonColor(neonColor);
  assertSizeAndColor(size, neonColor);

  const active = await findActive(identity);
  if (active) throw ApiError.badRequest(ACTIVE_GENERATION_ERROR);

  const imageUrl = await uploadService.putFile(file, 'custom-neon/source');

  let inputPayload;
  if (designType === 'upload') {
    inputPayload = { sourceImageUrl: imageUrl };
  } else if (designType === 'draw') {
    inputPayload = { strokes: strokes ?? null, renderedImageUrl: imageUrl };
  } else {
    if (!text) throw ApiError.badRequest('text is required for design_type "text"');
    inputPayload = { text, fontFamily: fontFamily ?? null, renderedImageUrl: imageUrl };
  }

  const modelIdentity = toModelIdentity(identity);
  const row = await customNeonDesignModel.insertDesign({
    userId: modelIdentity.userId,
    sessionId: modelIdentity.sessionId,
    designType,
    inputPayload,
    size,
    neonColor,
  });
  return shapeDesign(row);
}

async function getOwnedDesign(id, identity) {
  const row = await customNeonDesignModel.findById(id);
  if (!row) throw ApiError.notFound('Design not found');
  const isAdmin = identity.user?.role === 'admin';
  if (!isAdmin && !customNeonDesignModel.belongsToIdentity(row, toModelIdentity(identity))) {
    throw ApiError.notFound('Design not found');
  }
  return row;
}

async function getDesign(id, identity) {
  const row = await getOwnedDesign(id, identity);
  return shapeDesign(row);
}

// Backs the frontend's "is one of my designs currently generating" check —
// used to reattach to an in-progress design after a refresh/new tab, and to
// power the persistent site-wide "generating" indicator.
async function getActiveDesign(identity) {
  assertIdentity(identity);
  const row = await findActive(identity);
  return row ? shapeDesign(row) : null;
}

// Optionally updates size/neonColor before re-queuing, so changing either in
// the UI and hitting "Re-run AI preview" regenerates with the new values
// rather than silently keeping the ones from the first generation.
async function regenerate(id, identity, { size, neonColor } = {}) {
  const row = await getOwnedDesign(id, identity);
  neonColor = normalizeNeonColor(neonColor);
  if (size !== undefined || neonColor !== undefined) assertSizeAndColor(size, neonColor);

  const active = await findActive(identity);
  if (active && active.id !== row.id) throw ApiError.badRequest(ACTIVE_GENERATION_ERROR);
  if (row.status === 'pending' || row.status === 'processing') throw ApiError.badRequest(ACTIVE_GENERATION_ERROR);

  await customNeonDesignModel.requeue(id, { size, neonColor });
  return shapeDesign(await customNeonDesignModel.findById(id));
}

// Uses the size/neonColor already stored on the row (set at create/regenerate
// time, i.e. whatever the AI actually rendered) rather than accepting new
// values here — guarantees the purchased product always matches the preview
// image the customer confirmed, with no way for the two to drift apart.
//
// Idempotent for designs that were already confirmed once (row.product_id
// set): re-running the product-creation transaction would collide on the
// unique `sku` (NEON-${row.id}), so "confirm" on an already-confirmed design
// just re-adds the existing product to the cart instead — this is what lets
// the "Order again" button on the My Designs page reuse this same endpoint.
async function confirmDesign(id, identity) {
  const row = await getOwnedDesign(id, identity);
  if (row.status !== 'ready') throw ApiError.badRequest('Design preview is not ready yet');

  if (row.product_id) {
    const cart = await cartService.addItem(identity, row.product_id, 1);
    return { design: await shapeDesign(row), cart };
  }

  assertSizeAndColor(row.size, row.neon_color);

  const price = SIZE_PRICES[row.size];
  const category = await categoryModel.findBySlug(CUSTOM_NEON_CATEGORY_SLUG);
  if (!category) throw ApiError.internal('Custom neon category is not configured');

  const productId = await db.transaction(async (trx) => {
    const product = await productModel.insertProduct(
      {
        category_id: category.id,
        name: `Custom Neon Design #${row.id}`,
        // describeColorForCustomer keeps the raw "custom:#rrggbb" token out of
        // customer-visible order text. anthony_f/src/pages/admin/ProductForm.tsx
        // rebuilds this same string client-side — keep the two in step.
        description: `Custom AI-generated neon sign design (${SIZE_DIMENSIONS[row.size]}, ${describeColorForCustomer(row.neon_color)}).`,
        price,
        sku: `NEON-${row.id}`,
        stock_quantity: 9999,
      },
      trx
    );
    await trx('products').where({ id: product.id }).update({ is_active: false });
    await productImageModel.insertImages(
      [{ product_id: product.id, url: row.generated_image_url, is_primary: true, sort_order: 0 }],
      trx
    );
    await customNeonDesignModel.confirm({ id: row.id, price, productId: product.id }, trx);
    return product.id;
  });

  // Reuses the existing, unmodified cart flow — same as adding any other product.
  const cart = await cartService.addItem(identity, productId, 1);
  return { design: await shapeDesign(await customNeonDesignModel.findById(id)), cart };
}

// Admin-only: publish any ready design as a real, shop-visible catalog
// product. Deliberately different from confirmDesign above in three ways:
//
//  - No ownership check. Anonymous generation (routes: attachUserIfPresent
//    instead of requireAuth) means a design may have user_id NULL, which
//    belongsToIdentity can never match for a logged-in admin. That is exactly
//    the case this endpoint exists to rescue, so it keys on the design id
//    alone — requireAdmin on the route is the authorization.
//  - Its own SKU namespace. confirmDesign relies on NEON-${id} being unique
//    for its idempotency (see its comment above); reusing it here would make
//    a later customer confirm collide instead of re-adding to cart.
//  - is_active true. confirmDesign creates a hidden checkout vehicle; this
//    creates something customers can actually browse.
//
// Does not set design.product_id: that column means "confirmed into a
// customer order", and overloading it would both misreport the design as
// purchased and hide it from the cleanup job's purge candidates.
async function createProductFromDesign(designId, { name, description, price, categoryId, isActive = true }) {
  const row = await customNeonDesignModel.findById(designId);
  if (!row) throw ApiError.notFound('Design not found');
  if (row.status !== 'ready') throw ApiError.badRequest('Only a design with a ready preview can be published');
  if (!row.generated_image_url) {
    throw ApiError.badRequest('This design no longer has a preview image and cannot be published');
  }

  const category = await categoryModel.findById(categoryId);
  if (!category) throw ApiError.badRequest('Category not found');

  // Publishing leaves design.product_id null (see above), so the designs
  // list still offers "Create product" for an already-published design and
  // it is easy to click twice. products.sku is uniquely indexed, so the
  // second attempt would otherwise surface a raw ER_DUP_ENTRY as a 500 —
  // after having already uploaded a duplicate S3 object. Check first.
  const sku = `NEON-PUB-${row.id}`;
  const existing = await productModel.findBySku(sku);
  if (existing) {
    throw ApiError.conflict(`This design was already published as product #${existing.id}`);
  }

  // Copy rather than reference: the design's own image is a purge candidate
  // for as long as product_id stays null (neon-design-cleanup.js), so a
  // shared URL would 404 the moment that job runs. A copy keeps the
  // product's image lifecycle independent of the design's.
  const { buffer, mimetype } = await uploadService.getObjectBuffer(row.generated_image_url);
  const imageUrl = await uploadService.putBuffer(buffer, mimetype, 'products/custom-neon');

  const product = await db.transaction(async (trx) => {
    const created = await productModel.insertProduct(
      {
        category_id: category.id,
        name,
        description,
        price,
        sku,
        stock_quantity: 9999,
      },
      trx
    );
    if (!isActive) await trx('products').where({ id: created.id }).update({ is_active: false });
    await productImageModel.insertImages(
      [{ product_id: created.id, url: imageUrl, is_primary: true, sort_order: 0 }],
      trx
    );
    return productModel.findById(created.id, trx);
  });

  // Unlike confirmDesign's hidden per-order product, this is a browsable
  // catalog listing, so it needs the same background enrichment
  // product.service.createProduct gives everything else. Fire-and-forget for
  // the same reason it is there: both only enqueue work for out-of-process
  // workers, and neither should be able to fail the publish.
  productSeoSyncService.enqueueProduct(product).catch((err) => {
    console.error(`[customNeonDesign.service] enqueueProduct(${product.id}) failed`, err);
  });
  if (geminiIsConfigured) {
    productEmbeddingSyncService.syncProduct(product).catch((err) => {
      console.error(`[customNeonDesign.service] syncProduct(${product.id}) failed`, err);
    });
  }

  return product;
}

// Called from auth.service.js on register/login/OAuth, in the same
// transaction as the cart merge — anything generated anonymously before
// signing in should follow the visitor into their account.
async function mergeAnonDesignsIntoUser(sessionId, userId, trx) {
  if (!sessionId) return;
  await customNeonDesignModel.reassignSessionToUser(sessionId, userId, trx);
}

// Customer-facing "My Designs" list — every design the caller has ever
// generated (any status), so they can track pending previews and re-order
// past confirmed designs.
async function listMine(identity, { page, pageSize }) {
  assertIdentity(identity);
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const [rows, countRow] = identity.user
    ? await Promise.all([
        customNeonDesignModel.listMine(identity.user.id, { limit, offset }),
        customNeonDesignModel.countMine(identity.user.id),
      ])
    : await Promise.all([
        customNeonDesignModel.listMineBySessionId(identity.anonSessionId, { limit, offset }),
        customNeonDesignModel.countMineBySessionId(identity.anonSessionId),
      ]);
  return {
    items: await Promise.all(rows.map(shapeDesign)),
    total: Number(countRow.count),
    page,
    pageSize,
  };
}

const SHOWCASE_LABELS = {
  upload: 'Photo-inspired design',
  draw: 'Hand-drawn design',
  text: 'Custom text design',
};

// Public landing-page gallery. Only ever exposes the generated artwork image
// + a generic design-type label — never input_payload (a customer's
// uploaded photo or the text/name they typed), which stays admin-only.
async function listShowcase(limit) {
  const rows = await customNeonDesignModel.listShowcase(limit);
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      label: SHOWCASE_LABELS[row.design_type] ?? 'Custom design',
      dimensions: row.size ? SIZE_DIMENSIONS[row.size] : null,
      imageUrl: await signImageUrl(row.generated_image_url),
    })),
  );
}

async function listAdmin(query, { page, pageSize }) {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const filters = { status: query.status || null };
  const [rows, countRow] = await Promise.all([
    customNeonDesignModel.listAdmin(filters, { limit, offset }),
    customNeonDesignModel.countAdmin(filters),
  ]);
  return {
    items: await Promise.all(rows.map(shapeDesign)),
    total: Number(countRow.count),
    page,
    pageSize,
  };
}

async function getAdmin(id) {
  const row = await customNeonDesignModel.findById(id);
  if (!row) throw ApiError.notFound('Design not found');
  return shapeDesign(row);
}

async function updateAdminNotes(id, adminNotes) {
  const row = await customNeonDesignModel.findById(id);
  if (!row) throw ApiError.notFound('Design not found');
  await customNeonDesignModel.updateAdminNotes(id, adminNotes);
  return shapeDesign(await customNeonDesignModel.findById(id));
}

// Promotes a design into the public galleries, or removes it. Only the
// enable direction is guarded: listShowcase would silently skip a design
// without a finished preview, so allowing it would leave an admin looking at
// an "on" toggle for something that never appears. Hiding always works —
// including for a promoted design whose images were later purged.
async function setShowcased(id, isShowcased) {
  const row = await customNeonDesignModel.findById(id);
  if (!row) throw ApiError.notFound('Design not found');
  if (isShowcased && (row.status !== 'ready' || !row.generated_image_url || row.images_purged_at)) {
    throw ApiError.badRequest('Only a finished design with a preview can be shown in the gallery');
  }
  await customNeonDesignModel.setShowcased(id, isShowcased);
  return shapeDesign(await customNeonDesignModel.findById(id));
}

// Admin "Custom Neon Usage" tab — one row per user who has ever generated a
// design, with counts + last-activity timestamp, so admins can see who's
// using the feature (and spot anyone worth reviewing against the
// 2-per-minute generation rate limit).
async function getUsageByUser({ page, pageSize }) {
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const [rows, countRow] = await Promise.all([
    customNeonDesignModel.listUsageByUser({ limit, offset }),
    customNeonDesignModel.countUsageByUser(),
  ]);

  // The NULL bucket (anonymous visitors) has no user to look up.
  const users = await userModel.findByIds(rows.map((row) => row.user_id).filter((id) => id !== null));
  const userById = new Map(users.map((user) => [user.id, user]));

  return {
    items: rows.map((row) => {
      const user = userById.get(row.user_id);
      return {
        userId: row.user_id,
        userEmail: user?.email ?? null,
        userName: row.user_id === null ? 'Anonymous' : (user?.name ?? null),
        designCount: Number(row.designCount),
        confirmedCount: Number(row.confirmedCount),
        lastGeneratedAt: row.lastGeneratedAt,
      };
    }),
    total: Number(countRow.count),
    page,
    pageSize,
  };
}

module.exports = {
  SIZE_PRICES,
  SIZE_DIMENSIONS,
  CUSTOM_COLOR_RE,
  isValidNeonColor,
  normalizeNeonColor,
  describeColorForCustomer,
  createDesign,
  getDesign,
  getActiveDesign,
  regenerate,
  confirmDesign,
  createProductFromDesign,
  mergeAnonDesignsIntoUser,
  listMine,
  listShowcase,
  listAdmin,
  getAdmin,
  updateAdminNotes,
  setShowcased,
  getUsageByUser,
};
