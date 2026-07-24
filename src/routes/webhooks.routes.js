const express = require('express');
const paymentsController = require('../controllers/payments.controller');

const router = express.Router();

// No requireAuth — Stripe calls this directly; the Stripe-Signature header
// verified in the controller/service is the security boundary. Body parsing
// for this exact path is handled specially in app.js (express.raw()) ahead
// of the global express.json(), since signature verification needs the raw
// bytes.
router.post('/webhooks/stripe', paymentsController.stripeWebhook);

module.exports = router;
