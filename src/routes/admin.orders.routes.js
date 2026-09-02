const express = require('express');
const ordersController = require('../controllers/orders.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/admin/orders', requireAuth, requireAdmin, ordersController.listOrdersAdmin);
router.get('/admin/orders/:id', requireAuth, requireAdmin, ordersController.getOrderAdmin);
router.patch('/admin/orders/:id', requireAuth, requireAdmin, ordersController.patchOrderAdmin);
router.post('/admin/orders/:id/price-quote', requireAuth, requireAdmin, ordersController.priceQuoteAdmin);
router.get('/admin/orders/:id/invoice', requireAuth, requireAdmin, ordersController.downloadInvoice);
router.get('/admin/orders/:id/spec-sheet', requireAuth, requireAdmin, ordersController.downloadSpecSheet);

module.exports = router;
