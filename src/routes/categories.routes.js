const express = require('express');
const categoriesController = require('../controllers/categories.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/categories', categoriesController.listCategories);
router.post('/admin/categories', requireAuth, requireAdmin, categoriesController.createCategory);
router.put('/admin/categories/:id', requireAuth, requireAdmin, categoriesController.updateCategory);
router.delete('/admin/categories/:id', requireAuth, requireAdmin, categoriesController.deleteCategory);

module.exports = router;
