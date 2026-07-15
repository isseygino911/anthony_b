// Reads/validates process.env once, exports a typed config object.
// architecture.md §3: server/.env (this repo's own .env, at the server repo
// root) is the single source of config for both migrations/seeds and the
// server, now that server/ is its own standalone repo.
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

function required(name) {
  const value = process.env[name];
  if (value === undefined || value === '') return '';
  return value;
}

const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4002,
  isProduction: process.env.NODE_ENV === 'production',

  db: {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    name: process.env.DB_NAME,
  },

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  },

  aws: {
    accessKeyId: required('AWS_ACCESS_KEY_ID'),
    secretAccessKey: required('AWS_SECRET_ACCESS_KEY'),
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: required('S3_BUCKET_NAME'),
  },

  gemini: {
    apiKey: required('GEMINI_API_KEY'),
    embeddingModel: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    chatModel: process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
  },

  cookieDomain: process.env.COOKIE_DOMAIN || 'localhost',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  csrfSecret: process.env.CSRF_SECRET,
  defaultLowStockThreshold: Number(process.env.DEFAULT_LOW_STOCK_THRESHOLD) || 5,
};

module.exports = config;
