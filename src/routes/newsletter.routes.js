const express = require('express');
const newsletterController = require('../controllers/newsletter.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { newsletterLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.post('/newsletter/subscribe', newsletterLimiter, newsletterController.subscribe);
router.get('/admin/newsletter/subscribers', requireAuth, requireAdmin, newsletterController.listSubscribers);

module.exports = router;
