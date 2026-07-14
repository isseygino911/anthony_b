const express = require('express');
const multer = require('multer');
const productsController = require('../controllers/products.controller');
const { requireAuth, requireAdmin, attachUserIfPresent } = require('../middleware/auth.middleware');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.get('/products', attachUserIfPresent, productsController.listProducts);
router.get('/products/:id', attachUserIfPresent, productsController.getProduct);

router.post('/admin/products', requireAuth, requireAdmin, productsController.createProduct);
router.put('/admin/products/:id', requireAuth, requireAdmin, productsController.updateProduct);
router.delete('/admin/products/:id', requireAuth, requireAdmin, productsController.deleteProduct);
router.post('/admin/products/bulk-delete', requireAuth, requireAdmin, productsController.bulkDeleteProducts);
router.post(
  '/admin/products/:id/images',
  requireAuth,
  requireAdmin,
  upload.array('images'),
  productsController.uploadProductImages
);
router.patch(
  '/admin/products/:id/images/:imageId',
  requireAuth,
  requireAdmin,
  productsController.setPrimaryImage
);
router.delete(
  '/admin/products/:id/images/:imageId',
  requireAuth,
  requireAdmin,
  productsController.deleteProductImage
);
router.get('/admin/products/:id/seo', requireAuth, requireAdmin, productsController.getProductSeo);

module.exports = router;
