const express = require('express');
const ordersController = require('../controllers/orders.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { orderLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.post('/orders', requireAuth, orderLimiter, ordersController.createOrder);
router.get('/orders', requireAuth, ordersController.listMyOrders);
router.get('/orders/:id', requireAuth, ordersController.getMyOrder);

module.exports = router;
