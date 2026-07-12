const db = require('../config/db');

const TABLE = 'products';

const SORT_MAP = {
  price_asc: [['p.price', 'asc']],
  price_desc: [['p.price', 'desc']],
  name_asc: [['p.name', 'asc']],
  name_desc: [['p.name', 'desc']],
  newest: [['p.created_at', 'desc']],
};

function baseQuery(filters, trx = db) {
  const q = trx({ p: TABLE }).whereNull('p.deleted_at');

  if (filters.categoryId) {
    q.where('p.category_id', filters.categoryId);
  }
  if (filters.groupId) {
    q.join('product_group_items as pgi', 'pgi.product_id', 'p.id').where(
      'pgi.group_id',
      filters.groupId
    );
  }
  if (filters.search) {
    q.whereRaw('MATCH(p.name, p.description) AGAINST (? IN NATURAL LANGUAGE MODE)', [
      filters.search,
    ]);
  }
  if (filters.tag) {
    q.whereRaw('JSON_CONTAINS(p.tags, ?)', [JSON.stringify(filters.tag)]);
  }
  return q;
}

async function findAll(filters, { limit, offset }, trx = db) {
  const sort = SORT_MAP[filters.sort] || SORT_MAP.newest;
  const q = baseQuery(filters, trx)
    .select(
      'p.*',
      trx.raw(
        '(SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id AND pi.is_primary = 1 LIMIT 1) as primary_image_url'
      )
    )
    .limit(limit)
    .offset(offset);
  sort.forEach(([col, dir]) => q.orderBy(col, dir));
  return q;
}

async function count(filters, trx = db) {
  const row = await baseQuery(filters, trx).countDistinct({ count: 'p.id' }).first();
  return Number(row.count);
}

function findById(id, trx = db) {
  return trx(TABLE).where({ id }).whereNull('deleted_at').first();
}

function findByIdIncludingDeleted(id, trx = db) {
  return trx(TABLE).where({ id }).first();
}

function findByIdForUpdate(id, trx) {
  return trx(TABLE).where({ id }).forUpdate().first();
}

function findByIds(ids, trx = db) {
  if (!ids.length) return Promise.resolve([]);
  return trx(TABLE).whereIn('id', ids).whereNull('deleted_at');
}

async function insertProduct(data, trx = db) {
  const now = new Date();
  const [id] = await trx(TABLE).insert({
    category_id: data.category_id,
    name: data.name,
    description: data.description ?? null,
    price: data.price,
    sku: data.sku,
    tags: data.tags ? JSON.stringify(data.tags) : null,
    stock_quantity: data.stock_quantity ?? 0,
    low_stock_threshold: data.low_stock_threshold ?? null,
    is_featured: Boolean(data.is_featured),
    is_bestseller: Boolean(data.is_bestseller),
    is_clearance: Boolean(data.is_clearance),
    created_at: now,
    updated_at: now,
  });
  return findById(id, trx);
}

async function updateProduct(id, data, trx = db) {
  const patch = { updated_at: new Date() };
  const fields = [
    'category_id',
    'name',
    'description',
    'price',
    'sku',
    'stock_quantity',
    'low_stock_threshold',
    'is_featured',
    'is_bestseller',
    'is_clearance',
  ];
  fields.forEach((field) => {
    if (data[field] !== undefined) patch[field] = data[field];
  });
  if (data.tags !== undefined) patch.tags = data.tags ? JSON.stringify(data.tags) : null;

  await trx(TABLE).where({ id }).update(patch);
  return findById(id, trx);
}

function softDeleteProduct(id, trx = db) {
  return trx(TABLE).where({ id }).update({ deleted_at: new Date() });
}

function softDeleteMany(ids, trx = db) {
  return trx(TABLE).whereIn('id', ids).update({ deleted_at: new Date() });
}

function decrementStock(id, quantity, trx) {
  return trx(TABLE).where({ id }).decrement('stock_quantity', quantity);
}

module.exports = {
  findAll,
  count,
  findById,
  findByIdIncludingDeleted,
  findByIdForUpdate,
  findByIds,
  insertProduct,
  updateProduct,
  softDeleteProduct,
  softDeleteMany,
  decrementStock,
};
