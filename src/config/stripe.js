// Lazy-initialized Stripe SDK client. STRIPE_SECRET_KEY is unset in dev until
// the real key is provided (architecture.md — Stripe integration), so this
// must not throw at app-startup require-time; it only throws when a payment
// route is actually hit without a key configured.
const Stripe = require('stripe');
const config = require('./env');
const ApiError = require('../utils/apiError');

let client = null;

function getStripeClient() {
  if (!config.stripeSecretKey) {
    throw ApiError.internal('Stripe is not configured on this server');
  }
  if (!client) {
    client = new Stripe(config.stripeSecretKey);
  }
  return client;
}

module.exports = { getStripeClient };
