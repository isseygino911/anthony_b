// Entrypoint: http.listen, PM2-friendly.
const app = require('./app');
const config = require('./config/env');
const { isConfigured: geminiIsConfigured } = require('./config/gemini');
const embeddingCacheService = require('./services/embeddingCache.service');

// Log recoverable async errors without killing the process; let PM2 handle
// genuine crashes via uncaughtException below.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (err) => {
  // eslint-disable-next-line no-console
  console.error('[uncaughtException]', err);
  process.exit(1);
});

// Prime the in-process embedding cache for the assistant's retrieval.service
// (Stage 2). Non-fatal if it fails — the assistant would just retrieve
// nothing until a later reload/request-time load succeeds.
if (geminiIsConfigured) {
  embeddingCacheService.load().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[server] embeddingCache.service.load() failed at boot', err);
  });
}

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${config.port} (${config.nodeEnv})`);
});
