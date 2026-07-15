// Express app assembly: helmet, rate limiters, CSRF, routers.
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { bucket, region } = require('./config/s3');
const routes = require('./routes');
const { issueCsrfCookie, verifyCsrfToken } = require('./middleware/csrf.middleware');
const { generalLimiter } = require('./middleware/rateLimit.middleware');
const errorHandler = require('./middleware/errorHandler.middleware');
const ApiError = require('./utils/apiError');
const config = require('./config/env');

const app = express();

const s3ConnectSrc = bucket ? [`https://${bucket}.s3.${region}.amazonaws.com`] : [];

// architecture.md §9 — Helmet default config + CSP connect-src allowance for
// the S3 bucket domain (images) and Google OAuth domains.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'connect-src': ["'self'", ...s3ConnectSrc, 'https://accounts.google.com', 'https://oauth2.googleapis.com'],
        'img-src': ["'self'", 'data:', ...s3ConnectSrc],
      },
    },
  })
);

// Frontend and API are served from separate subdomains (architecture.md §3),
// so cross-origin requests need CORS. credentials: true + an exact reflected
// origin (never '*') because auth relies on cookies. X-CSRF-Token is a custom
// header the CSRF double-submit-cookie flow (csrf.middleware.js) needs the
// browser to be allowed to send cross-origin.
app.use(
  cors({
    origin: config.clientOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
  })
);

app.use(express.json());
app.use(cookieParser());
app.use(generalLimiter);
app.use(issueCsrfCookie);
app.use(verifyCsrfToken);

app.use('/api', routes);

app.use((req, res, next) => next(ApiError.notFound('Route not found')));
app.use(errorHandler);

module.exports = app;
