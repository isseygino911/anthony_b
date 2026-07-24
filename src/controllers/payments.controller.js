const paymentService = require('../services/payment.service');
const asyncHandler = require('../utils/asyncHandler');

const createPaymentIntent = asyncHandler(async (req, res) => {
  const result = await paymentService.createOrReusePaymentIntent(Number(req.params.id), req.user);
  res.status(200).json(result);
});

// req.body is the raw Buffer here (see app.js — express.raw() is applied to
// this route ahead of the global express.json() parser) so Stripe's
// signature verification sees the exact bytes it signed.
const stripeWebhook = asyncHandler(async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const event = paymentService.constructWebhookEvent(req.body, signature);
  await paymentService.handleWebhookEvent(event);
  res.status(200).json({ received: true });
});

module.exports = { createPaymentIntent, stripeWebhook };
