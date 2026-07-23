const newsletterModel = require('../models/newsletterSubscriber.model');
const ApiError = require('../utils/apiError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function subscribe(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(normalized)) {
    throw ApiError.badRequest('A valid email address is required');
  }

  const existing = await newsletterModel.findByEmail(normalized);
  if (!existing) {
    await newsletterModel.insert(normalized);
  }
  // Same response whether already on the list or not — don't leak which
  // emails are already subscribed.
  return { subscribed: true };
}

async function listSubscribers({ page = 1, pageSize = 50 } = {}) {
  const limit = Math.min(200, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;
  const [items, countRow] = await Promise.all([
    newsletterModel.list({ limit, offset }),
    newsletterModel.count(),
  ]);
  return { items, total: Number(countRow.count) };
}

module.exports = { subscribe, listSubscribers };
