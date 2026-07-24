const db = require('../config/db');
const customNeonDesignModel = require('../models/customNeonDesign.model');
const productModel = require('../models/product.model');
const productImageModel = require('../models/productImage.model');
const categoryModel = require('../models/category.model');
const userModel = require('../models/user.model');
const uploadService = require('../services/upload.service');
const cartService = require('./cart.service');
const ApiError = require('../utils/apiError');
const { signImageUrl } = require('../utils/signedImageUrl');

const CUSTOM_NEON_CATEGORY_SLUG = 'custom-neon-signs';

// Not admin-configurable today — revisit if pricing needs to change per-design.
const SIZE_PRICES = { small: 249.99, medium: 399.99, large: 524.99 };
const SIZE_DIMENSIONS = { small: '12"x12"', medium: '24"x24"', large: '36"x36"' };
const NEON_COLORS = ['amber', 'pink', 'blue', 'white'];

function assertSizeAndColor(size, neonColor) {
  if (!SIZE_PRICES[size]) throw ApiError.badRequest('Invalid size');
  if (!NEON_COLORS.includes(neonColor)) throw ApiError.badRequest('Invalid neon_color');
}

function toModelIdentity(identity) {
  return { userId: identity.user?.id ?? null, sessionId: identity.anonSessionId ?? null };
}

function assertIdentity(identity) {
  if (!identity.user) throw ApiError.badRequest('No design identity available');
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
    adminNotes: row.admin_notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createDesign(identity, { designType, file, strokes, text, fontFamily, size, neonColor }) {
  assertIdentity(identity);
  if (!file) throw ApiError.badRequest('No design image uploaded');
  if (!['upload', 'draw', 'text'].includes(designType)) throw ApiError.badRequest('Invalid design_type');
  assertSizeAndColor(size, neonColor);

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

// Optionally updates size/neonColor before re-queuing, so changing either in
// the UI and hitting "Re-run AI preview" regenerates with the new values
// rather than silently keeping the ones from the first generation.
async function regenerate(id, identity, { size, neonColor } = {}) {
  await getOwnedDesign(id, identity);
  if (size !== undefined || neonColor !== undefined) assertSizeAndColor(size, neonColor);
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
        description: `Custom AI-generated neon sign design (${SIZE_DIMENSIONS[row.size]}, ${row.neon_color}).`,
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

// Customer-facing "My Designs" list — every design the caller has ever
// generated (any status), so they can track pending previews and re-order
// past confirmed designs.
async function listMine(identity, { page, pageSize }) {
  assertIdentity(identity);
  const userId = identity.user.id;
  const limit = pageSize;
  const offset = (page - 1) * pageSize;
  const [rows, countRow] = await Promise.all([
    customNeonDesignModel.listMine(userId, { limit, offset }),
    customNeonDesignModel.countMine(userId),
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

  const users = await userModel.findByIds(rows.map((row) => row.user_id));
  const userById = new Map(users.map((user) => [user.id, user]));

  return {
    items: rows.map((row) => {
      const user = userById.get(row.user_id);
      return {
        userId: row.user_id,
        userEmail: user?.email ?? null,
        userName: user?.name ?? null,
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
  NEON_COLORS,
  createDesign,
  getDesign,
  regenerate,
  confirmDesign,
  listMine,
  listShowcase,
  listAdmin,
  getAdmin,
  updateAdminNotes,
  getUsageByUser,
};
