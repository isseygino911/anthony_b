/**
 * One-off, re-runnable script (not a knex seed — deliberately outside
 * migrations/seeds/ so `npm run seed` never picks it up and clobbers live
 * site_theme/product data). Generates simple placeholder product photography
 * locally (no external downloads), uploads it to the real S3 bucket via the
 * app's own upload pipeline conventions, and gives each demo product a
 * multi-image gallery + a fuller description.
 *
 * Usage: node scripts/seed-product-media.js
 */
const zlib = require('zlib');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const db = require('../src/config/db');
const { s3Client, bucket, region, isConfigured } = require('../src/config/s3');

if (!isConfigured) {
  console.error('S3 is not configured (check AWS_* env vars) — aborting.');
  process.exit(1);
}

// ---- minimal PNG encoder (solid background + a centered placeholder shape) ----

let crcTable;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function buildPng(width, height, pixelFn) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = pngChunk('IHDR', ihdrData);

  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter: none
    offset += 1;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelFn(x, y);
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      offset += 3;
    }
  }
  const idat = pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 }));
  const iend = pngChunk('IEND', Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

const SIZE = 900;

const SHAPES = {
  rect: (x, y) => x >= SIZE * 0.2 && x <= SIZE * 0.8 && y >= SIZE * 0.2 && y <= SIZE * 0.8,
  circle: (x, y) => {
    const dx = x - SIZE / 2;
    const dy = y - SIZE / 2;
    return Math.sqrt(dx * dx + dy * dy) <= SIZE * 0.32;
  },
  band: (x, y) => y >= SIZE * 0.36 && y <= SIZE * 0.64,
  inset: (x, y) => x >= SIZE * 0.36 && x <= SIZE * 0.64 && y >= SIZE * 0.36 && y <= SIZE * 0.64,
};

function placeholderImage(shape, bg, fg) {
  const test = SHAPES[shape];
  return buildPng(SIZE, SIZE, (x, y) => (test(x, y) ? fg : bg));
}

async function uploadPlaceholder(productId, shape, bg, fg) {
  const buf = placeholderImage(shape, bg, fg);
  const key = `products/${productId}/${uuidv4()}.png`;
  await s3Client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: 'image/png' }),
  );
  return `https://${bucket}.s3.${region}.amazonaws.com/${key}`;
}

// ---- demo content ----

const DEMO_MEDIA = [
  {
    sku: 'DEMO-TEE-001',
    bg: [240, 240, 240],
    fg: [45, 45, 45],
    description:
      'Cut from heavyweight combed cotton, this crewneck is built for everyday rotation — soft enough for a lazy Sunday, sturdy enough to hold its shape wash after wash. The relaxed fit sits easy through the shoulders and body without feeling boxy, and a reinforced collar keeps its structure long after other tees have given up. Pre-shrunk and garment-dyed for a lived-in look from the first wear.',
  },
  {
    sku: 'DEMO-TOTE-002',
    bg: [244, 241, 235],
    fg: [176, 141, 87],
    description:
      'A no-fuss canvas tote built to carry everything from groceries to gym gear without complaint. Heavyweight 12oz cotton canvas resists tearing and holds its shape even when loaded up, while reinforced stitching at the handles and base is rated for real daily use, not just show. Wide handles sit comfortably on the shoulder, and the open top makes it easy to grab what you need without digging.',
  },
  {
    sku: 'DEMO-HOODIE-003',
    bg: [238, 240, 242],
    fg: [70, 85, 99],
    description:
      "A breathable zip hoodie designed to layer well without adding bulk. The brushed interior traps just enough warmth for cool mornings and air-conditioned offices, while the smooth-running zipper and ribbed cuffs keep things streamlined. Two side pockets are deep enough for a phone and keys, and the fabric moves with you whether you're commuting, running errands, or winding down.",
  },
];

const SHAPE_ORDER = ['rect', 'circle', 'band', 'inset'];

async function run() {
  for (const item of DEMO_MEDIA) {
    const product = await db('products').where({ sku: item.sku }).first();
    if (!product) {
      console.warn(`Skipping ${item.sku} — no matching product found.`);
      // eslint-disable-next-line no-continue
      continue;
    }

    console.log(`Uploading images for ${product.name} (#${product.id})...`);
    const urls = [];
    for (const shape of SHAPE_ORDER) {
      // eslint-disable-next-line no-await-in-loop
      const url = await uploadPlaceholder(product.id, shape, item.bg, item.fg);
      urls.push(url);
    }

    await db('product_images').where({ product_id: product.id }).del();
    await db('product_images').insert(
      urls.map((url, index) => ({
        product_id: product.id,
        url,
        is_primary: index === 0,
        sort_order: index,
        created_at: db.fn.now(),
      })),
    );

    await db('products').where({ id: product.id }).update({
      description: item.description,
      updated_at: db.fn.now(),
    });

    console.log(`  -> ${urls.length} images uploaded, description updated.`);
  }

  await db.destroy();
  console.log('Done.');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
