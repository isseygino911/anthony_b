const express = require('express');
const multer = require('multer');
const documentsController = require('../controllers/documents.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth.middleware');

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

router.get('/documents', documentsController.listDocuments);
router.get('/documents/:id', documentsController.getDocument);

router.post(
  '/admin/documents',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  documentsController.createDocument
);
router.put('/admin/documents/:id', requireAuth, requireAdmin, documentsController.updateDocument);
router.delete('/admin/documents/:id', requireAuth, requireAdmin, documentsController.deleteDocument);
router.post(
  '/admin/documents/reindex-all',
  requireAuth,
  requireAdmin,
  documentsController.reindexAllDocuments
);
router.post(
  '/admin/documents/:id/reindex',
  requireAuth,
  requireAdmin,
  documentsController.reindexDocument
);

module.exports = router;
