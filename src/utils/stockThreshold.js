const config = require('../config/env');

// architecture.md §7.2 — per-product override, else global default.
function resolveLowStockThreshold(product) {
  return product.low_stock_threshold ?? config.defaultLowStockThreshold;
}

module.exports = { resolveLowStockThreshold };
