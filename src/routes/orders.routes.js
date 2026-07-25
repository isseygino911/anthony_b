const express = require('express');
const ordersController = require('../controllers/orders.controller');
const paymentsController = require('../controllers/payments.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { orderLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.post('/orders', requireAuth, orderLimiter, ordersController.createOrder);
router.get('/orders', requireAuth, ordersController.listMyOrders);
router.get('/orders/:id', requireAuth, ordersController.getMyOrder);
router.delete('/orders/:id', requireAuth, orderLimiter, ordersController.cancelMyOrder);
router.post('/orders/:id/create-payment-intent', requireAuth, orderLimiter, paymentsController.createPaymentIntent);

module.exports = router;
