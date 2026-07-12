const express = require('express');
const dashboardController = require('../controllers/dashboard.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/admin/dashboard/revenue', requireAuth, requireAdmin, dashboardController.getRevenue);

module.exports = router;
