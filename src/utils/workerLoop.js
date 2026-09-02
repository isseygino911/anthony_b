/**
 * Shared poll-loop plumbing for the standalone workers (neon-design-worker,
 * seo-geo-worker), which are structurally identical: own process, own poll
 * loop, one tick() per interval.
 *
 * Exists because the hosted MySQL runs wait_timeout=20s, so it hangs up on idle
 * connections aggressively — and an AI generation tick routinely outlasts that
 * while waiting on Gemini. The pool reaps its own connections early (see
 * src/config/db.js) so it rarely hands out a dead socket, but a connection can
 * still die mid-tick. Without this, that surfaces as PROTOCOL_CONNECTION_LOST
 * killing the tick.
 */

const CONNECTION_ERROR_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'EPIPE',
  'ETIMEDOUT',
  'ER_CON_COUNT_ERROR',
]);

function isConnectionError(err) {
  return Boolean(err && CONNECTION_ERROR_CODES.has(err.code));
}

/**
 * Runs `tick` once, retrying a single time if it failed purely because the
 * database connection dropped. Only retries once: if a fresh connection also
 * fails the database is genuinely unreachable, and the caller's poll interval
 * is the right place to back off rather than hammering it.
 *
 * Never throws — a worker loop should always live to poll again.
 */
async function runTick(tick, label) {
  try {
    await tick();
  } catch (err) {
    if (!isConnectionError(err)) {
      console.error(`[${label}] tick failed`, err);
      return;
    }
    console.error(`[${label}] lost DB connection (${err.code}) — retrying tick once`);
    try {
      await tick();
    } catch (retryErr) {
      console.error(`[${label}] tick failed after reconnect`, retryErr);
    }
  }
}

module.exports = { isConnectionError, runTick };
