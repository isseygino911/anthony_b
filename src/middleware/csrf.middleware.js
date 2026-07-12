const crypto = require('crypto');
const config = require('../config/env');
const ApiError = require('../utils/apiError');

const COOKIE_NAME = 'csrf_token';
const HEADER_NAME = 'x-csrf-token';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes that establish auth itself and are explicitly exempted from CSRF
// per architecture.md §4 header note.
const EXEMPT_PATHS = new Set(['/api/auth/register', '/api/auth/login', '/api/auth/google/callback']);

function generateToken() {
  return crypto.createHmac('sha256', config.csrfSecret).update(crypto.randomBytes(32)).digest('hex');
}

// Issues the double-submit CSRF cookie on any request that doesn't already
// have one. Client JS reads this cookie and echoes it back as a header on
// mutating requests.
function issueCsrfCookie(req, res, next) {
  if (!req.cookies?.[COOKIE_NAME]) {
    const token = generateToken();
    res.cookie(COOKIE_NAME, token, {
      httpOnly: false,
      sameSite: 'lax',
      secure: config.isProduction,
      domain: config.cookieDomain,
      maxAge: MAX_AGE_MS,
    });
    req.cookies[COOKIE_NAME] = token;
  }
  next();
}

// Verifies the header matches the cookie on mutating requests, except the
// auth-establishing routes listed above.
function verifyCsrfToken(req, res, next) {
  if (!MUTATING_METHODS.has(req.method) || EXEMPT_PATHS.has(req.path)) {
    return next();
  }
  const cookieToken = req.cookies?.[COOKIE_NAME];
  const headerToken = req.headers[HEADER_NAME];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return next(ApiError.forbidden('Invalid or missing CSRF token'));
  }
  return next();
}

module.exports = { issueCsrfCookie, verifyCsrfToken, COOKIE_NAME };
