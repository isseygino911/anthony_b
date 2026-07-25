// Stripe Payment Intents integration — architecture.md "Stripe integration".
// This is the ONLY module that talks to the Stripe SDK. It never flips
// orders.status itself except inside handleWebhookEvent's
// payment_intent.succeeded branch (the sole pending_payment -> processing
// transition point, per architecture.md §7.3).
const db = require('../config/db');
const config = require('../config/env');
const { getStripeClient } = require('../config/stripe');
const orderModel = require('../models/order.model');
const orderAuditLogModel = require('../models/orderAuditLog.model');
const ApiError = require('../utils/apiError');

const CURRENCY = 'usd';

// A PaymentIntent is safe to reuse if it hasn't already been finalized —
// otherwise (succeeded/canceled/etc.) a fresh one is created instead.
const REUSABLE_STATUSES = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

async function createOrReusePaymentIntent(orderId, requester) {
  const order = await orderModel.findById(orderId);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.user_id !== requester.id && requester.role !== 'admin') {
    throw ApiError.notFound('Order not found');
  }
  if (order.status !== 'pending_payment') {
    throw ApiError.badRequest('Order is not awaiting payment');
  }

  const stripe = getStripeClient();
  const amount = Math.round(Number(order.total) * 100);

  if (order.stripe_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);
    if (REUSABLE_STATUSES.has(existing.status)) {
      const updated = await stripe.paymentIntents.update(existing.id, { amount });
      return { clientSecret: updated.client_secret };
    }
  }

  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: CURRENCY,
    metadata: { order_id: String(order.id) },
  });
  await orderModel.updateStripePaymentIntentId(order.id, paymentIntent.id);

  return { clientSecret: paymentIntent.client_secret };
}

function constructWebhookEvent(rawBody, signature) {
  const stripe = getStripeClient();
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, config.stripeWebhookSecret);
  } catch (err) {
    // Almost always a mismatched STRIPE_WEBHOOK_SECRET (stale dev secret, or
    // Stripe Dashboard endpoint pointing at a different secret than what's
    // deployed) — logged here because this used to fail silently, leaving
    // orders stuck at pending_payment with no visible cause.
    console.error('[stripe-webhook] signature verification failed:', err.message);
    throw ApiError.badRequest('Invalid Stripe webhook signature');
  }
}

// architecture.md §7.3 — the ONLY code path allowed to transition
// pending_payment -> processing.
async function handlePaymentIntentSucceeded(paymentIntent) {
  await db.transaction(async (trx) => {
    const order = await orderModel.findByStripePaymentIntentId(paymentIntent.id, trx);
    if (!order) {
      console.error(`[stripe-webhook] no order found for payment_intent ${paymentIntent.id}`);
      return;
    }
    if (order.status !== 'pending_payment') {
      console.error(
        `[stripe-webhook] order ${order.id} already left pending_payment (status=${order.status}) — ignoring duplicate/late payment_intent.succeeded for ${paymentIntent.id}`
      );
      return;
    }

    await orderModel.updateStatus(order.id, 'processing', trx);
    await orderAuditLogModel.insertEntry(
      {
        orderId: order.id,
        actorUserId: null,
        fieldChanged: 'status',
        oldValue: order.status,
        newValue: 'processing',
        reason: 'Stripe payment succeeded',
      },
      trx
    );
  });
}

async function handleWebhookEvent(event) {
  switch (event.type) {
    case 'payment_intent.succeeded':
      await handlePaymentIntentSucceeded(event.data.object);
      break;
    case 'payment_intent.payment_failed':
      // Order stays pending_payment so the customer can retry — nothing to do
      // beyond acknowledging receipt.
      break;
    default:
      console.log(`[stripe-webhook] unhandled event type: ${event.type}`);
      break;
  }
}

module.exports = { createOrReusePaymentIntent, constructWebhookEvent, handleWebhookEvent };
