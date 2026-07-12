const express = require('express');
const notificationsController = require('../controllers/notifications.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/admin/notifications', requireAuth, requireAdmin, notificationsController.listNotifications);
router.patch('/admin/notifications/:id/read', requireAuth, requireAdmin, notificationsController.markRead);
router.patch('/admin/notifications/read-all', requireAuth, requireAdmin, notificationsController.markAllRead);

module.exports = router;
