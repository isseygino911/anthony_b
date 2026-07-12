// Entrypoint: http.listen, PM2-friendly.
const app = require('./app');
const config = require('./config/env');

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

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on port ${config.port} (${config.nodeEnv})`);
});
