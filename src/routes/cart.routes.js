const express = require('express');
const cartController = require('../controllers/cart.controller');
const { attachUserIfPresent } = require('../middleware/auth.middleware');
const { ensureAnonSession } = require('../middleware/anonSession.middleware');

const router = express.Router();

// Cart works for both anonymous and logged-in callers (architecture.md §4.5).
// Anon session cookie is only issued for unauthenticated visitors (§2).
function maybeAnonSession(req, res, next) {
  if (req.user) return next();
  return ensureAnonSession(req, res, next);
}

router.use(attachUserIfPresent, maybeAnonSession);

router.get('/cart', cartController.getCart);
router.post('/cart/items', cartController.addItem);
router.patch('/cart/items/:productId', cartController.updateItem);
router.delete('/cart/items/:productId', cartController.removeItem);
router.delete('/cart', cartController.clearCart);

module.exports = router;
