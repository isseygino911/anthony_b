const express = require('express');
const ordersController = require('../controllers/orders.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/admin/orders', requireAuth, requireAdmin, ordersController.listOrdersAdmin);
router.get('/admin/orders/:id', requireAuth, requireAdmin, ordersController.getOrderAdmin);
router.patch('/admin/orders/:id', requireAuth, requireAdmin, ordersController.patchOrderAdmin);

module.exports = router;
