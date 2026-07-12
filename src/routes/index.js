const express = require('express');

const authRoutes = require('./auth.routes');
const productsRoutes = require('./products.routes');
const categoriesRoutes = require('./categories.routes');
const groupsRoutes = require('./groups.routes');
const cartRoutes = require('./cart.routes');
const favoritesRoutes = require('./favorites.routes');
const ordersRoutes = require('./orders.routes');
const adminOrdersRoutes = require('./admin.orders.routes');
const themeRoutes = require('./theme.routes');
const notificationsRoutes = require('./notifications.routes');
const dashboardRoutes = require('./dashboard.routes');

const router = express.Router();

router.use(authRoutes);
router.use(productsRoutes);
router.use(categoriesRoutes);
router.use(groupsRoutes);
router.use(cartRoutes);
router.use(favoritesRoutes);
router.use(ordersRoutes);
router.use(adminOrdersRoutes);
router.use(themeRoutes);
router.use(notificationsRoutes);
router.use(dashboardRoutes);

module.exports = router;
