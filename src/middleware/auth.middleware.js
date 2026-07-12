const jwt = require('jsonwebtoken');
const config = require('../config/env');
const ApiError = require('../utils/apiError');
const userModel = require('../models/user.model');

const COOKIE_NAME = 'auth_token';

function verifyToken(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwt.secret);
  } catch {
    return null;
  }
}

// Decodes the JWT cookie if present and attaches req.user; does not reject
// the request if absent/invalid. Used by routes that behave differently for
// anonymous vs. logged-in callers (e.g. cart).
async function attachUserIfPresent(req, res, next) {
  const payload = verifyToken(req);
  if (payload) {
    const user = await userModel.findById(payload.sub);
    req.user = user || null;
  } else {
    req.user = null;
  }
  next();
}

async function requireAuth(req, res, next) {
  const payload = verifyToken(req);
  if (!payload) return next(ApiError.unauthorized());
  const user = await userModel.findById(payload.sub);
  if (!user) return next(ApiError.unauthorized());
  req.user = user;
  return next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return next(ApiError.forbidden());
  return next();
}

module.exports = { requireAuth, requireAdmin, attachUserIfPresent, COOKIE_NAME };
