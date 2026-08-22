/**
 * Polls custom_neon_designs for 'pending' rows (queued by
 * customNeonDesign.service.js when a customer submits an upload/drawing/
 * typed-text design) and, for each, sends the flattened input image to
 * Gemini's image-generation model with a prompt that turns it into a
 * photorealistic neon-sign product photo, then uploads the result to S3 and
 * persists the row.
 *
 * Structurally identical to seo-geo-worker.js: own long-lived process, own
 * poll loop, headless (just GEMINI_API_KEY + AWS creds), so a slow/stuck AI
 * call never affects API request latency. Each tick's batch is processed
 * concurrently (Promise.all) rather than serially, so multiple customers'
 * generations run in parallel instead of queueing behind each other.
 *
 * Usage: node scripts/neon-design-worker.js
 */
const db = require('../src/config/db');
const { genAI, isConfigured: geminiConfigured } = require('../src/config/gemini');
const { isConfigured: s3Configured } = require('../src/config/s3');
const neonPromptTemplateService = require('../src/services/neonPromptTemplate.service');
const neonSketchInterpreterService = require('../src/services/neonSketchInterpreter.service');
const uploadService = require('../src/services/upload.service');
const customNeonDesignModel = require('../src/models/customNeonDesign.model');

const POLL_INTERVAL_MS = Number(process.env.NEON_WORKER_POLL_INTERVAL_MS) || 20000;
// Batch members are now processed concurrently (see tick()), so this bounds
// how many customers' generations run in parallel per poll tick rather than
// how many run serially — raised from the old serial-era default of 3.
const BATCH_SIZE = Number(process.env.NEON_WORKER_BATCH_SIZE) || 6;

function parsePayload(payload) {
  return typeof payload === 'string' ? JSON.parse(payload) : payload;
}

// upload's sourceImageUrl / draw & text's renderedImageUrl are the same
// concept: "the flattened image to send to the AI" — just named per-type so
// each mode's native data stays distinct in the DB (per design decision).
function inputImageUrl(row) {
  const payload = parsePayload(row.input_payload);
  return payload.sourceImageUrl || payload.renderedImageUrl;
}

function extractGeneratedImage(response) {
  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find((part) => part.inlineData?.data);
  if (!imagePart) return null;
  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimetype: imagePart.inlineData.mimeType || 'image/png',
  };
}

async function processRow(row) {
  await customNeonDesignModel.markProcessing(row.id);

  const imageUrl = inputImageUrl(row);
  if (!imageUrl) throw new Error('Design row has no usable input image URL');

  const { buffer, mimetype } = await uploadService.getObjectBuffer(imageUrl);
  const imageBase64 = buffer.toString('base64');

  // Hand-drawn sketches get a vision pass first: the image model cannot infer
  // what a crude drawing depicts while it is busy copying it, so identify the
  // subject up front and hand that to the prompt. Returns null (never throws)
  // when unavailable or unsure, in which case buildRequest falls back to the
  // unguided wording and generation proceeds exactly as before.
  let sketch = null;
  if (row.design_type === 'draw') {
    sketch = await neonSketchInterpreterService.interpretSketch({
      imageBase64,
      imageMimeType: mimetype,
    });
    console.log(
      sketch
        ? `[neon-design-worker] design ${row.id} sketch read as "${sketch.subject}" (confidence ${sketch.confidence})`
        : `[neon-design-worker] design ${row.id} sketch not confidently identified — generating unguided`
    );
  }

  const request = neonPromptTemplateService.buildRequest({
    designType: row.design_type,
    size: row.size,
    neonColor: row.neon_color,
    imageBase64,
    imageMimeType: mimetype,
    sketch,
  });

  const response = await genAI.models.generateContent(request);
  const generated = extractGeneratedImage(response);
  if (!generated) {
    throw new Error(`Gemini response contained no image data: ${JSON.stringify(response).slice(0, 500)}`);
  }

  const generatedImageUrl = await uploadService.putBuffer(
    generated.buffer,
    generated.mimetype,
    `custom-neon/generated/${row.id}`
  );

  await customNeonDesignModel.saveResult({ id: row.id, status: 'ready', generatedImageUrl });
  console.log(`[neon-design-worker] design ${row.id} -> ready`);
}

async function tick() {
  if (!geminiConfigured) {
    console.error('[neon-design-worker] GEMINI_API_KEY not set — skipping tick');
    return;
  }
  if (!s3Configured) {
    console.error('[neon-design-worker] S3 not configured — skipping tick');
    return;
  }

  const reclaimed = await customNeonDesignModel.reclaimStuckProcessing();
  if (reclaimed > 0) {
    console.error(`[neon-design-worker] reclaimed ${reclaimed} design(s) stuck in 'processing'`);
  }

  const pending = await customNeonDesignModel.listPending(BATCH_SIZE);
  await Promise.all(
    pending.map(async (row) => {
      try {
        await processRow(row);
      } catch (err) {
        console.error(`[neon-design-worker] design ${row.id} failed`, err);
        await customNeonDesignModel.markFailed(row.id, err.message || String(err));
      }
    })
  );

  console.log(`[neon-design-worker] tick complete — processed ${pending.length}`);
}

let stopped = false;
async function loop() {
  if (stopped) return;
  try {
    await tick();
  } catch (err) {
    console.error('[neon-design-worker] tick failed', err);
  }
  if (!stopped) setTimeout(loop, POLL_INTERVAL_MS);
}

function shutdown() {
  stopped = true;
  db.destroy().finally(() => process.exit(0));
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`[neon-design-worker] started (poll every ${POLL_INTERVAL_MS}ms, batch ${BATCH_SIZE})`);
  loop();
}

module.exports = { processRow, tick, extractGeneratedImage, inputImageUrl };
