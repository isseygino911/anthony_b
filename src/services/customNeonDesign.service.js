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
// 'custom' is deliberately absent: a customer-specified size has no price the
// business can compute up front, and its absence from this map is what every
// "is this quotable?" check keys on (isQuoteSize below). Adding a price here
// would silently turn custom-size designs back into instant-checkout ones.
const SIZE_PRICES = { small: 249.99, medium: 399.99, large: 524.99 };
const SIZE_DIMENSIONS = { small: '12"x12"', medium: '24"x24"', large: '36"x36"' };

// The fourth option: the customer types their own width/height and the design
// is priced by hand afterwards. See migrations 038 (columns) and 039 (the
// pending_quote order state this eventually produces).
const CUSTOM_SIZE = 'custom';
const SIZES = [...Object.keys(SIZE_PRICES), CUSTOM_SIZE];

// Bounds on the typed dimensions. The lower bound rejects nonsense (0, a
// stray decimal) and the upper one keeps a request inside what can actually
// be fabricated and shipped, so an admin never has to reply "we cannot build
// a 900-inch sign". Inches, matching SIZE_DIMENSIONS above.
const MIN_CUSTOM_IN = 4;
const MAX_CUSTOM_IN = 120;

function isQuoteSize(size) {
  return size === CUSTOM_SIZE;
}

// Parses one typed dimension. Rejects NaN/Infinity/negatives up front, then
// rounds to 2dp to match the DECIMAL(6,2) column so the value read back from
// the database is identical to the one validated here — otherwise a design
// could pass validation and come back subtly different in the AI prompt and
// the customer-facing label.
function parseDimension(value, field) {
  const num = Number(value);
  if (!Number.isFinite(num)) throw ApiError.badRequest(`${field} must be a number`);
  const rounded = Math.round(num * 100) / 100;
  if (rounded < MIN_CUSTOM_IN || rounded > MAX_CUSTOM_IN) {
    throw ApiError.badRequest(`${field} must be between ${MIN_CUSTOM_IN} and ${MAX_CUSTOM_IN} inches`);
  }
  return rounded;
}

// Formats stored dimensions the same way SIZE_DIMENSIONS formats presets, so
// everything downstream (product description, showcase label, admin views)
// renders one consistent '<w>"x<h>"' string regardless of which path the
// design came from. DECIMAL(6,2) comes back from MySQL as "30.00", so the
// trailing zeros are dropped to read as 30" rather than 30.00".
function formatInches(value) {
  return String(Number(value));
}

function describeDimensions(row) {
  if (!isQuoteSize(row.size)) return SIZE_DIMENSIONS[row.size] ?? null;
  if (row.custom_width_in == null || row.custom_height_in == null) return null;
  return `${formatInches(row.custom_width_in)}"x${formatInches(row.custom_height_in)}"`;
}

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

// Validates the size/colour pair and, for the custom size, the typed
// dimensions alongside them. Returns the parsed dimensions so callers store
// exactly what was validated rather than re-reading the raw request values:
// {customWidthIn, customHeightIn}, both null for a preset size.
//
// Presets must NOT carry dimensions — a row with size 'large' and a stray
// 50x50 on it would render one thing in the product description
// (SIZE_DIMENSIONS) and another in the admin view, so the two are rejected
// together rather than silently ignored.
// The colour as it should read on an order line. Differs from
// describeColorForCustomer above, which is prose for a product description
// ("custom #FF2D95"): here a customer-picked colour is the bare hex, because
// that is the value that identifies the colour to whoever fabricates the
// sign. Presets keep their slug title-cased ('ice-blue' -> 'Ice Blue').
function labelNeonColor(neonColor) {
  const hex = /^custom:(#[0-9a-f]{6})$/.exec(String(neonColor ?? ''));
  if (hex) return hex[1].toUpperCase();
  return String(neonColor ?? '')
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// The size/dimensions/colour snapshot attached to a neon line at checkout.
//
// Shaped as a `choices` array rather than a bespoke object so it reuses the
// snapshot format configurable products already produce
// (pricing.service.js#computePrice) — the cart drawer, the order pages and
// the admin order view all iterate `choices` and therefore render these with
// no UI changes at all. priceDelta is 0 throughout: a neon design is priced
// by its tier (SIZE_PRICES) or by hand, never by per-option deltas, and a
// non-zero value here would be double-counted as a flat fee at checkout.
//
// Written onto the order line so the order stays readable on its own terms:
// products.description carries the same facts as prose today, but the line's
// FK is ON DELETE SET NULL, so deleting the product would otherwise leave an
// order line that says only "Custom Neon Design #7".
function buildNeonSnapshot(row) {
  const choices = [
    {
      groupKey: 'neon_size',
      groupLabel: 'Size',
      choiceKey: row.size,
      // 'custom' on its own tells a reader nothing, so it reads as the
      // dimensions the customer actually asked for.
      choiceLabel: isQuoteSize(row.size) ? 'Custom' : capitalize(row.size),
      priceDelta: 0,
      isFlatFee: false,
    },
    {
      groupKey: 'neon_dimensions',
      groupLabel: 'Dimensions',
      choiceKey: describeDimensions(row) ?? '',
      choiceLabel: describeDimensions(row) ?? '—',
      priceDelta: 0,
      isFlatFee: false,
    },
    {
      groupKey: 'neon_color',
      groupLabel: 'Colour',
      // The raw stored token ('custom:#ff2d95' / 'ice-blue') is kept as the
      // machine-readable key; choiceLabel is what a person reads.
      choiceKey: row.neon_color,
      choiceLabel: labelNeonColor(row.neon_color),
      priceDelta: 0,
      isFlatFee: false,
    },
  ];

  return {
    // sizeInches is the configurable-product notion of a single linear size
    // and does not apply to a two-dimensional neon sign; the dimensions live
    // in the choices above. Kept null so the shape stays uniform.
    sizeInches: null,
    totalWatts: 0,
    choices,
    flatFeeDelta: 0,
  };
}

function capitalize(value) {
  const text = String(value ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function assertSizeAndColor(size, neonColor, dimensions = {}) {
  if (!SIZES.includes(size)) throw ApiError.badRequest('Invalid size');
  if (!isValidNeonColor(neonColor)) throw ApiError.badRequest('Invalid neon_color');

  const { customWidthIn, customHeightIn } = dimensions;
  if (!isQuoteSize(size)) {
    if (customWidthIn != null || customHeightIn != null) {
      throw ApiError.badRequest('Custom dimensions are only valid with the custom size');
    }
    return { customWidthIn: null, customHeightIn: null };
  }

  if (customWidthIn == null || customHeightIn == null) {
    throw ApiError.badRequest('Width and height are required for a custom size');
  }
  return {
    customWidthIn: parseDimension(customWidthIn, 'Width'),
    customHeightIn: parseDimension(customHeightIn, 'Height'),
  };
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
    customWidthIn: row.custom_width_in !== null ? Number(row.custom_width_in) : null,
    customHeightIn: row.custom_height_in !== null ? Number(row.custom_height_in) : null,
    // One derived label so no caller has to know whether this design used a
    // preset or typed dimensions.
    dimensions: describeDimensions(row),
    // Tells the storefront to show "Pricing TBD" instead of a figure, and to
    // collect contact details before checkout. Derived rather than stored so
    // it can never disagree with `size`.
    isQuote: isQuoteSize(row.size),
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

async function createDesign(
  identity,
  { designType, file, strokes, text, fontFamily, size, neonColor, customWidthIn, customHeightIn }
) {
  assertIdentity(identity);
  if (!file) throw ApiError.badRequest('No design image uploaded');
  if (!['upload', 'draw', 'text'].includes(designType)) throw ApiError.badRequest('Invalid design_type');
  // Canonicalise before validating so the stored form is the one the
  // storefront's stale-preview comparison expects (see normalizeNeonColor).
  neonColor = normalizeNeonColor(neonColor);
  const dimensions = assertSizeAndColor(size, neonColor, { customWidthIn, customHeightIn });

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
    ...dimensions,
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
async function regenerate(id, identity, { size, neonColor, customWidthIn, customHeightIn } = {}) {
  const row = await getOwnedDesign(id, identity);
  neonColor = normalizeNeonColor(neonColor);
  let dimensions;
  if (size !== undefined || neonColor !== undefined) {
    dimensions = assertSizeAndColor(size, neonColor, { customWidthIn, customHeightIn });
  }

  const active = await findActive(identity);
  if (active && active.id !== row.id) throw ApiError.badRequest(ACTIVE_GENERATION_ERROR);
  if (row.status === 'pending' || row.status === 'processing') throw ApiError.badRequest(ACTIVE_GENERATION_ERROR);

  // Switching a design away from the custom size has to clear the old
  // dimensions, not just leave them behind — assertSizeAndColor rejects a
  // preset that still carries them, so a stale pair would make every
  // subsequent regenerate/confirm on this row fail validation.
  await customNeonDesignModel.requeue(id, { size, neonColor, ...(dimensions ?? {}) });
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
    // Re-order path ("Order again"): rebuild the snapshot from the design so
    // the repeat line carries the same size/dimensions/colour as the first.
    const cart = await cartService.addItem(identity, row.product_id, 1, null, buildNeonSnapshot(row));
    return { design: await shapeDesign(row), cart };
  }

  assertSizeAndColor(row.size, row.neon_color, {
    customWidthIn: row.custom_width_in,
    customHeightIn: row.custom_height_in,
  });

  // A custom-size design has no price yet. The product is still created (the
  // cart and order flows work in terms of products, and the customer has
  // finished designing), but at 0.00 with is_quote set — order.service.js
  // reads that flag to hold the resulting order at pending_quote instead of
  // charging 0. The real figure is written by the admin at pricing time.
  const quote = isQuoteSize(row.size);
  const price = quote ? 0 : SIZE_PRICES[row.size];
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
        description: `Custom AI-generated neon sign design (${describeDimensions(row)}, ${describeColorForCustomer(row.neon_color)}).`,
        price,
        sku: `NEON-${row.id}`,
        stock_quantity: 9999,
      },
      trx
    );
    if (quote) await trx('products').where({ id: product.id }).update({ is_quote: true });
    await trx('products').where({ id: product.id }).update({ is_active: false });
    await productImageModel.insertImages(
      [{ product_id: product.id, url: row.generated_image_url, is_primary: true, sort_order: 0 }],
      trx
    );
    // price stays NULL on a quote design — the column is nullable precisely
    // so "not priced yet" is representable rather than being faked as 0.
    await customNeonDesignModel.confirm({ id: row.id, price: quote ? null : price, productId: product.id }, trx);
    return product.id;
  });

  // Reuses the existing cart flow — same as adding any other product, plus the
  // size/dimensions/colour snapshot that makes the resulting order line
  // readable without joining back to the product or the design.
  const cart = await cartService.addItem(identity, productId, 1, null, buildNeonSnapshot(row));
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
      dimensions: describeDimensions(row),
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
  SIZES,
  CUSTOM_SIZE,
  MIN_CUSTOM_IN,
  MAX_CUSTOM_IN,
  isQuoteSize,
  describeDimensions,
  CUSTOM_COLOR_RE,
  isValidNeonColor,
  normalizeNeonColor,
  describeColorForCustomer,
  labelNeonColor,
  buildNeonSnapshot,
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
