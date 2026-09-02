const express = require('express');
const customerNotificationsController = require('../controllers/customerNotifications.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Customer-scoped counterpart to admin.notifications — requireAuth only, and
// every handler reads req.user.id rather than accepting a user id from the
// client, so these can only ever return the caller's own notifications.
router.get('/notifications', requireAuth, customerNotificationsController.listMine);
router.patch('/notifications/read-all', requireAuth, customerNotificationsController.markAllRead);
router.patch('/notifications/:id/read', requireAuth, customerNotificationsController.markRead);

module.exports = router;
