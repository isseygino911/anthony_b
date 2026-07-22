/**
 * Fast inner loop for tuning neonPromptTemplate.service.js's prompt wording
 * against a fixed test input, completely bypassing the DB/worker/polling
 * pipeline (no custom_neon_designs row, no S3 upload) — the result is
 * written straight to a local output directory as a numbered PNG so it can
 * be eyeballed against a target reference photo round after round.
 *
 * Usage: node scripts/tune-neon-prompt.js <inputImagePath> [--size=medium] [--color=amber] [--type=draw] [--out=./tmp/neon-tuning]
 */
const fs = require('fs');
const path = require('path');
const { genAI, isConfigured: geminiConfigured } = require('../src/config/gemini');
const neonPromptTemplateService = require('../src/services/neonPromptTemplate.service');

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  argv.forEach((arg) => {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) flags[match[1]] = match[2];
    else positional.push(arg);
  });
  return { positional, flags };
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

function extFor(mimetype) {
  if (mimetype.includes('jpeg')) return '.jpg';
  if (mimetype.includes('webp')) return '.webp';
  return '.png';
}

function nextRunNumber(outDir) {
  if (!fs.existsSync(outDir)) return 1;
  const existing = fs
    .readdirSync(outDir)
    .map((name) => /^tune-(\d+)/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  return existing.length ? Math.max(...existing) + 1 : 1;
}

async function main() {
  if (!geminiConfigured) {
    console.error('GEMINI_API_KEY is not set — cannot run a generation.');
    process.exit(1);
  }

  const { positional, flags } = parseArgs(process.argv.slice(2));
  const inputPath = positional[0];
  if (!inputPath) {
    console.error('Usage: node scripts/tune-neon-prompt.js <inputImagePath> [--size=] [--color=] [--type=] [--out=]');
    process.exit(1);
  }

  const designType = flags.type || 'draw';
  const size = flags.size || 'medium';
  const neonColor = flags.color || 'amber';
  const outDir = path.resolve(flags.out || './tmp/neon-tuning');
  fs.mkdirSync(outDir, { recursive: true });

  const imageBuffer = fs.readFileSync(inputPath);
  const imageMimeType = /\.png$/i.test(inputPath) ? 'image/png' : 'image/jpeg';

  const request = neonPromptTemplateService.buildRequest({
    designType,
    size,
    neonColor,
    imageBase64: imageBuffer.toString('base64'),
    imageMimeType,
  });

  console.log(`[tune-neon-prompt] prompt: ${neonPromptTemplateService.buildInstruction({ designType, size, neonColor })}`);

  const response = await genAI.models.generateContent(request);
  const generated = extractGeneratedImage(response);
  if (!generated) {
    console.error('No image returned. Full response:', JSON.stringify(response).slice(0, 2000));
    process.exit(1);
  }

  const runNumber = String(nextRunNumber(outDir)).padStart(2, '0');
  const outPath = path.join(outDir, `tune-${runNumber}${extFor(generated.mimetype)}`);
  fs.writeFileSync(outPath, generated.buffer);
  console.log(`[tune-neon-prompt] wrote ${outPath}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
