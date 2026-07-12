const config = require('../config/env');
const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const { COOKIE_NAME } = require('../middleware/auth.middleware');

const AUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7; // fallback; jwt itself carries expiresIn

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    domain: config.cookieDomain,
    maxAge: AUTH_COOKIE_MAX_AGE_MS,
  });
}

const register = asyncHandler(async (req, res) => {
  const { email, password, name } = req.body;
  const { user, token } = await authService.register({ email, password, name }, req.cookies?.anon_session_id);
  setAuthCookie(res, token);
  res.status(201).json({ user });
});

const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const { user, token } = await authService.login({ email, password }, req.cookies?.anon_session_id);
  setAuthCookie(res, token);
  res.status(200).json({ user });
});

const googleRedirect = asyncHandler(async (req, res) => {
  const url = authService.getGoogleAuthUrl();
  res.redirect(url);
});

const googleCallback = asyncHandler(async (req, res) => {
  const { code } = req.query;
  const { token } = await authService.handleGoogleCallback(code, req.cookies?.anon_session_id);
  setAuthCookie(res, token);
  res.redirect(config.clientOrigin);
});

const logout = asyncHandler(async (req, res) => {
  res.clearCookie(COOKIE_NAME, { domain: config.cookieDomain });
  res.status(204).end();
});

const me = asyncHandler(async (req, res) => {
  res.status(200).json({ user: authService.toPublicUser(req.user) });
});

module.exports = { register, login, googleRedirect, googleCallback, logout, me };
