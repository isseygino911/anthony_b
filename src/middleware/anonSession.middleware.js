const { v4: uuidv4 } = require('uuid');
const config = require('../config/env');
const anonSessionModel = require('../models/anonSession.model');

const COOKIE_NAME = 'anon_session_id';
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 365; // 1 year, long-lived per architecture.md §9
const TOUCH_INTERVAL_MS = 1000 * 60 * 60; // opportunistic touch, at most hourly

function setCookie(res, sessionId) {
  res.cookie(COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    domain: config.cookieDomain,
    maxAge: MAX_AGE_MS,
  });
}

// Ensures an anon_session_id cookie + anon_sessions row exist. Mounted on
// cart routes only (architecture.md §2: issued "on first cart-touching
// request"), not globally.
async function ensureAnonSession(req, res, next) {
  try {
    let sessionId = req.cookies?.[COOKIE_NAME];
    let session = sessionId ? await anonSessionModel.findById(sessionId) : null;

    if (!session) {
      sessionId = uuidv4();
      await anonSessionModel.insert(sessionId);
      setCookie(res, sessionId);
    } else {
      setCookie(res, sessionId); // refresh maxAge
      const staleMs = Date.now() - new Date(session.last_seen_at).getTime();
      if (staleMs > TOUCH_INTERVAL_MS) {
        await anonSessionModel.touchLastSeen(sessionId);
      }
    }

    req.anonSessionId = sessionId;
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { ensureAnonSession, COOKIE_NAME };
