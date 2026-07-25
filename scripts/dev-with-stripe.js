/**
 * Runs `stripe listen`, the API dev server, AND the neon-design worker
 * together, so `npm run dev` alone is a complete local dev environment — no
 * separate terminal(s) needed. Previously the worker had to be started
 * separately (`npm run neon-worker`), which was easy to forget — designs
 * would sit at status='pending' forever with no error shown anywhere,
 * looking exactly like a hang. Tying it to this same script means Ctrl+C
 * here also stops it, instead of leaving it running orphaned.
 *
 * `stripe listen` prints a fresh STRIPE_WEBHOOK_SECRET every time it starts
 * (session-specific, can't be hardcoded in .env), so this script captures
 * that value from its stdout and rewrites .env before booting nodemon —
 * nodemon/dotenv only read .env at process start, so the secret must land
 * there first.
 *
 * Usage: node scripts/dev-with-stripe.js [--live]
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ENV_PATH = path.join(__dirname, '..', '.env');
const STRIPE_BIN = path.join(process.env.HOME || '', '.local', 'bin', 'stripe');
const live = process.argv.includes('--live');

// STRIPE_SECRET_KEY must be sk_test_/sk_live_ matching the --live flag, or
// signature verification (which uses the matching whsec_ below) will fail
// against every event. STRIPE_SECRET_KEY_TEST/_LIVE in .env are the permanent,
// never-overwritten source of truth for each mode's key — this only ever
// copies FROM one of those INTO the active STRIPE_SECRET_KEY line, so neither
// reference value can ever be lost by repeated swapping (unlike editing
// comments in place, which loses whichever value was last active).
function ensureSecretKeyMatchesMode() {
  const contents = fs.readFileSync(ENV_PATH, 'utf8');
  const wantVar = live ? 'STRIPE_SECRET_KEY_LIVE' : 'STRIPE_SECRET_KEY_TEST';
  const wantMatch = contents.match(new RegExp(`^${wantVar}=(\\S+)$`, 'm'));

  if (!wantMatch) {
    console.warn(
      `[dev-with-stripe] ${wantVar} not found in .env — add it so this script can switch modes. ` +
        `Leaving STRIPE_SECRET_KEY as-is.`
    );
    return;
  }

  const activeMatch = contents.match(/^STRIPE_SECRET_KEY=(\S+)$/m);
  if (activeMatch && activeMatch[1] === wantMatch[1]) return; // already correct

  const updated = /^STRIPE_SECRET_KEY=.*$/m.test(contents)
    ? contents.replace(/^STRIPE_SECRET_KEY=.*$/m, `STRIPE_SECRET_KEY=${wantMatch[1]}`)
    : `${contents.trimEnd()}\nSTRIPE_SECRET_KEY=${wantMatch[1]}\n`;
  fs.writeFileSync(ENV_PATH, updated);
  console.log(`[dev-with-stripe] set STRIPE_SECRET_KEY from ${wantVar} (${live ? 'LIVE' : 'test'} mode)`);
}

function updateWebhookSecretInEnv(secret) {
  const contents = fs.readFileSync(ENV_PATH, 'utf8');
  const line = `STRIPE_WEBHOOK_SECRET=${secret}`;
  const updated = /^STRIPE_WEBHOOK_SECRET=.*$/m.test(contents)
    ? contents.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, line)
    : `${contents.trimEnd()}\n${line}\n`;
  fs.writeFileSync(ENV_PATH, updated);
}

function startNodemon() {
  const nodemon = spawn('npx', ['nodemon', 'src/server.js'], {
    stdio: 'inherit',
    shell: true,
  });
  nodemon.on('exit', (code) => process.exit(code ?? 0));
  return nodemon;
}

// Own nodemon instance (rather than reusing the server's) so editing
// scripts/neon-design-worker.js or its dependencies restarts just the
// worker, not the API server, and vice versa.
function startNeonWorker() {
  const worker = spawn('npx', ['nodemon', 'scripts/neon-design-worker.js'], {
    stdio: 'inherit',
    shell: true,
  });
  worker.on('exit', (code) => {
    if (code && code !== 0) console.error(`[dev-with-stripe] neon-design-worker exited with code ${code}`);
  });
  return worker;
}

ensureSecretKeyMatchesMode();

const listenArgs = ['listen', '--forward-to', 'localhost:4002/api/webhooks/stripe'];
if (live) listenArgs.push('--live');

console.log(`[dev-with-stripe] starting stripe listen${live ? ' (LIVE mode)' : ' (test mode)'}...`);
const stripeListen = spawn(STRIPE_BIN, listenArgs, { shell: true });

let secretCaptured = false;
let nodemonProcess = null;
let neonWorkerProcess = null;

stripeListen.stdout.on('data', (chunk) => process.stdout.write(chunk));
stripeListen.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  process.stderr.write(chunk);

  if (!secretCaptured) {
    const match = text.match(/whsec_[a-zA-Z0-9]+/);
    if (match) {
      secretCaptured = true;
      updateWebhookSecretInEnv(match[0]);
      console.log(`[dev-with-stripe] wrote fresh STRIPE_WEBHOOK_SECRET to .env, starting server...`);
      nodemonProcess = startNodemon();
      console.log('[dev-with-stripe] starting neon-design-worker...');
      neonWorkerProcess = startNeonWorker();
    }
  }
});

stripeListen.on('exit', (code) => {
  console.log('[dev-with-stripe] stripe listen exited, stopping server...');
  if (nodemonProcess) nodemonProcess.kill();
  if (neonWorkerProcess) neonWorkerProcess.kill();
  process.exit(code ?? 0);
});

process.on('SIGINT', () => {
  stripeListen.kill();
  if (nodemonProcess) nodemonProcess.kill();
  if (neonWorkerProcess) neonWorkerProcess.kill();
  process.exit(0);
});
