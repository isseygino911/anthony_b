const express = require('express');
const favoritesController = require('../controllers/favorites.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get('/favorites', requireAuth, favoritesController.listFavorites);
router.post('/favorites/:productId', requireAuth, favoritesController.addFavorite);
router.delete('/favorites/:productId', requireAuth, favoritesController.removeFavorite);

module.exports = router;
