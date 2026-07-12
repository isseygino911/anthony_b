// Express app assembly: helmet, rate limiters, CSRF, routers.
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { bucket, region } = require('./config/s3');
const routes = require('./routes');
const { issueCsrfCookie, verifyCsrfToken } = require('./middleware/csrf.middleware');
const { generalLimiter } = require('./middleware/rateLimit.middleware');
const errorHandler = require('./middleware/errorHandler.middleware');
const ApiError = require('./utils/apiError');

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

app.use(express.json());
app.use(cookieParser());
app.use(generalLimiter);
app.use(issueCsrfCookie);
app.use(verifyCsrfToken);

app.use('/api', routes);

app.use((req, res, next) => next(ApiError.notFound('Route not found')));
app.use(errorHandler);

module.exports = app;
