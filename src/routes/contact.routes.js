const express = require('express');
const contactController = require('../controllers/contact.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');
const { contactLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

// Submitting requires an account: it ties every enquiry to a real identity,
// which is both the anti-spam mechanism for this endpoint and what lets an
// admin follow up through the customer record.
router.post('/contact', requireAuth, contactLimiter, contactController.submit);

router.get('/admin/contact/submissions', requireAuth, requireAdmin, contactController.listSubmissions);
router.get('/admin/contact/submissions/:id', requireAuth, requireAdmin, contactController.getSubmission);
router.patch('/admin/contact/submissions/:id', requireAuth, requireAdmin, contactController.updateSubmission);

module.exports = router;
