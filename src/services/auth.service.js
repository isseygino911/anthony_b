const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../config/db');
const config = require('../config/env');
const userModel = require('../models/user.model');
const cartService = require('./cart.service');
const ApiError = require('../utils/apiError');

const SALT_ROUNDS = 10;

function toPublicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function issueJwt(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });
}

async function register({ email, password, name }, anonSessionId) {
  const existing = await userModel.findByEmail(email);
  if (existing) throw ApiError.conflict('An account with this email already exists');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

  const user = await db.transaction(async (trx) => {
    const created = await userModel.insertUser(
      { email, passwordHash, provider: 'local', name, role: 'customer' },
      trx
    );
    await cartService.mergeAnonCartIntoUser(anonSessionId, created.id, trx);
    return created;
  });

  return { user: toPublicUser(user), token: issueJwt(user) };
}

async function login({ email, password }, anonSessionId) {
  const user = await userModel.findByEmail(email);
  if (!user || !user.password_hash) throw ApiError.unauthorized('Invalid email or password');

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw ApiError.unauthorized('Invalid email or password');

  // architecture.md §6 — cart merge runs inside the same transaction as the
  // auth event, before the response is sent. Merge logic itself lives only
  // in cart.service.js; every auth method just calls it.
  await db.transaction((trx) => cartService.mergeAnonCartIntoUser(anonSessionId, user.id, trx));

  return { user: toPublicUser(user), token: issueJwt(user) };
}

const googleClient = config.google.clientId ? new OAuth2Client(config.google.clientId) : null;

function getGoogleAuthUrl() {
  if (!googleClient) throw ApiError.internal('Google OAuth not configured');
  return googleClient.generateAuthUrl({
    scope: ['profile', 'email'],
    redirect_uri: config.google.callbackUrl,
  });
}

// Exchanges the OAuth `code` for tokens, verifies the ID token, and
// find-or-creates a `users` row with provider='google' (architecture.md §4.1).
async function handleGoogleCallback(code, anonSessionId) {
  if (!googleClient) throw ApiError.internal('Google OAuth not configured');

  const { tokens } = await googleClient.getToken({ code, redirect_uri: config.google.callbackUrl });
  const ticket = await googleClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: config.google.clientId,
  });
  const payload = ticket.getPayload();

  let user = await userModel.findByProvider('google', payload.sub);

  user = await db.transaction(async (trx) => {
    let existing = user;
    if (!existing) {
      existing = await userModel.findByEmail(payload.email, trx);
    }
    if (!existing) {
      existing = await userModel.insertUser(
        {
          email: payload.email,
          provider: 'google',
          providerId: payload.sub,
          name: payload.name || payload.email,
          role: 'customer',
        },
        trx
      );
    }
    await cartService.mergeAnonCartIntoUser(anonSessionId, existing.id, trx);
    return existing;
  });

  return { user: toPublicUser(user), token: issueJwt(user) };
}

module.exports = {
  toPublicUser,
  issueJwt,
  register,
  login,
  getGoogleAuthUrl,
  handleGoogleCallback,
};
