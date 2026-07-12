const express = require('express');
const authController = require('../controllers/auth.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { loginLimiter } = require('../middleware/rateLimit.middleware');

const router = express.Router();

router.post('/auth/register', authController.register);
router.post('/auth/login', loginLimiter, authController.login);
router.get('/auth/google', authController.googleRedirect);
router.get('/auth/google/callback', authController.googleCallback);
router.post('/auth/logout', requireAuth, authController.logout);
router.get('/auth/me', requireAuth, authController.me);

module.exports = router;
