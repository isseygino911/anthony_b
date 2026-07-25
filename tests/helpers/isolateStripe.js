// Same require-cache-preload trick as isolateDb.js, for the same reason:
// order.service.js does `require('../config/stripe')` at module-load time,
// and vi.mock does not intercept that nested CJS require. This preloads
// Node's require.cache for config/stripe.js's resolved path with a fake
// client before order.service.js (or payment.service.js) ever requires it,
// so no real Stripe API call is ever made during tests.
//
// Takes `vi` as a parameter (rather than requiring 'vitest' itself) because
// vitest's package refuses to be loaded via require() from a CommonJS file.
const Module = require('module');
const path = require('path');

const STRIPE_PATH = require.resolve(path.join(__dirname, '..', '..', 'src', 'config', 'stripe.js'));

function isolateStripe(vi) {
  const fakeClient = {
    refunds: { create: vi.fn().mockResolvedValue({ id: 're_test' }) },
    paymentIntents: {
      cancel: vi.fn().mockResolvedValue({}),
      retrieve: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  const fakeModule = new Module(STRIPE_PATH, module);
  fakeModule.filename = STRIPE_PATH;
  fakeModule.loaded = true;
  fakeModule.exports = { getStripeClient: () => fakeClient };
  require.cache[STRIPE_PATH] = fakeModule;

  return fakeClient;
}

module.exports = { isolateStripe, STRIPE_PATH };
