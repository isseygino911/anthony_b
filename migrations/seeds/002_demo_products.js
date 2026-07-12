/**
 * Seeds one demo category and 2-3 demo products (with a placeholder primary
 * image each) so the storefront has something to render.
 *
 * Image URLs are placeholders (placehold.co), not real S3 assets — noted per
 * task instructions; the backend/frontend engineers should swap these for
 * real S3-hosted images once upload is wired up.
 */
exports.seed = async function seed(knex) {
  // Re-runnable: clear in FK-safe order (children first) before reinserting.
  await knex('product_images').del();
  await knex('products').del();
  await knex('categories').del();

  const now = knex.fn.now();

  const [categoryId] = await knex('categories').insert({
    name: 'Apparel',
    slug: 'apparel',
    created_at: now,
  });

  const products = [
    {
      category_id: categoryId,
      name: 'Classic Crewneck Tee',
      description: 'A soft, everyday cotton crewneck in a relaxed fit.',
      price: 24.0,
      sku: 'DEMO-TEE-001',
      tags: JSON.stringify(['cotton', 'unisex', 'basics']),
      stock_quantity: 50,
      low_stock_threshold: null,
      is_featured: true,
      is_bestseller: true,
      is_clearance: false,
      created_at: now,
      updated_at: now,
    },
    {
      category_id: categoryId,
      name: 'Everyday Canvas Tote',
      description: 'Durable canvas tote bag for daily errands.',
      price: 18.5,
      sku: 'DEMO-TOTE-002',
      tags: JSON.stringify(['canvas', 'accessories']),
      stock_quantity: 30,
      low_stock_threshold: 5,
      is_featured: true,
      is_bestseller: false,
      is_clearance: false,
      created_at: now,
      updated_at: now,
    },
    {
      category_id: categoryId,
      name: 'Lightweight Zip Hoodie',
      description: 'A breathable zip-up hoodie for cool evenings.',
      price: 42.0,
      sku: 'DEMO-HOODIE-003',
      tags: JSON.stringify(['fleece', 'unisex']),
      stock_quantity: 15,
      low_stock_threshold: null,
      is_featured: false,
      is_bestseller: false,
      is_clearance: true,
      created_at: now,
      updated_at: now,
    },
  ];

  const productIds = [];
  for (const product of products) {
    // eslint-disable-next-line no-await-in-loop
    const [id] = await knex('products').insert(product);
    productIds.push(id);
  }

  const placeholderImages = [
    'https://placehold.co/600x600?text=Classic+Crewneck+Tee',
    'https://placehold.co/600x600?text=Canvas+Tote',
    'https://placehold.co/600x600?text=Zip+Hoodie',
  ];

  await knex('product_images').insert(
    productIds.map((productId, index) => ({
      product_id: productId,
      url: placeholderImages[index],
      is_primary: true,
      sort_order: 0,
      created_at: now,
    }))
  );
};
