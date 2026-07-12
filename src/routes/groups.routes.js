const express = require('express');
const groupsController = require('../controllers/groups.controller');
const productsController = require('../controllers/products.controller');
const { requireAuth, requireAdmin, attachUserIfPresent } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/groups', groupsController.listGroups);
router.get('/groups/:id/products', attachUserIfPresent, groupsController.listGroupProducts);

router.post('/admin/groups', requireAuth, requireAdmin, groupsController.createGroup);
router.put('/admin/groups/:id', requireAuth, requireAdmin, groupsController.updateGroup);
router.delete('/admin/groups/:id', requireAuth, requireAdmin, groupsController.deleteGroup);
router.put('/admin/groups/:id/products', requireAuth, requireAdmin, groupsController.setGroupProducts);

// Same join table as /admin/groups/:id/products (architecture.md §4.4) —
// writes via productGroupItem.model.js keep both directions in sync.
router.put('/admin/products/:id/groups', requireAuth, requireAdmin, productsController.setProductGroups);

module.exports = router;
